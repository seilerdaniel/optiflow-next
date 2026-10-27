import type { PoolClient, QueryResultRow } from "pg";
import { LOCK_OT, getPool, query, withTransaction } from "@/lib/db";
import {
  ApiError,
  booleano,
  decimal,
  textoOpcional,
  textoRequerido,
} from "@/lib/http";
import {
  areaPiezaM2,
  dimensionesDe,
  r3,
  resumirDespiece,
  type DespieceCompleto,
  type DespieceOT,
  type HerrajeDespiece,
  type HojaHerrajes,
  type ModuloDespiece,
  type PiezaDespiece,
  type ResumenPlaca,
} from "@/lib/despiece";
import { ahoraUTC } from "@/lib/produccion";

/*
 * Despiece data layer (Oficina Técnica).
 *
 * Every write is a real transaction with `LOCK_OT`: importing a despiece is a
 * replace-all, so two planners saving the same OT at once would otherwise
 * interleave their deletes and inserts and produce a half-merged structure.
 *
 * D3 (floor work is never lost): a re-import preserves `cargado_en_flete` and
 * `fecha_cargado` for pieces that are still the same physical piece, matched by
 * module + piece + material + size + quantity. If a dispatched piece would
 * disappear, the whole import is rejected with 409 instead of deleting evidence
 * that Control de Flete already did its job. The same rule protects hardware
 * already delivered by the pañol.
 *
 * Bultos (D2) belong to the module: the server numbers 1..N in payload order and
 * never accepts a client-provided number, so there are no duplicates or gaps.
 */

type Fila<T> = T & QueryResultRow;

/**
 * Anything that can run a query: the pool for reads, the transaction client for
 * reads/writes that must see the same snapshot.
 */
type Consultable = Pick<PoolClient, "query">;

export interface ResultadoPieza {
  id: number;
  ot_id: number;
  cargado_en_flete: boolean;
  fecha_cargado: string | null;
}

export interface ResultadoHerraje {
  id: number;
  ot_id: number;
  entregado_por_panol: boolean;
  fecha_entrega: string | null;
}

/* -------------------------------------------------------------------------- */
/* Limits                                                                      */
/* -------------------------------------------------------------------------- */

/** Body is capped at 1 MB; these stop a pathological payload from running long. */
const MAX_MODULOS = 500;
const MAX_PIEZAS_TOTAL = 5_000;
const MAX_HERRAJES = 2_000;
const MAX_LOTE = 200;

/* -------------------------------------------------------------------------- */
/* Payload validation                                                          */
/* -------------------------------------------------------------------------- */

interface PiezaImportada {
  nombre_pieza: string;
  material: string;
  dimensiones: string;
  ancho_mm: number;
  profundo_mm: number;
  cantidad: number;
  requiere_lustre: boolean;
}

interface HerrajeImportado {
  herraje: string;
  cantidad: number;
  entregado_por_panol: boolean;
}

interface ModuloImportado {
  nombre: string;
  piezas: PiezaImportada[];
  herrajes: HerrajeImportado[];
}

function objeto(valor: unknown, campo: string): Record<string, unknown> {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
    throw new ApiError(400, `El campo "${campo}" debe ser un objeto.`);
  }
  return valor as Record<string, unknown>;
}

/** Required list; `[]` is valid and means "empty". */
function lista(valor: unknown, campo: string): unknown[] {
  if (valor === undefined || valor === null) {
    throw new ApiError(400, `El campo "${campo}" es obligatorio. Enviá [] para vaciarlo.`);
  }
  if (!Array.isArray(valor)) {
    throw new ApiError(400, `El campo "${campo}" debe ser una lista.`);
  }
  return valor;
}

/** Optional list: omitted means "no rows", not "keep the old ones". */
function listaOpcional(valor: unknown, campo: string): unknown[] {
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor)) {
    throw new ApiError(400, `El campo "${campo}" debe ser una lista.`);
  }
  return valor;
}

function enteroPositivo(valor: unknown, campo: string, porDefecto: number): number {
  if (valor === undefined || valor === null || valor === "") return porDefecto;

  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 1) {
    throw new ApiError(400, `El campo "${campo}" debe ser un entero mayor o igual a 1.`);
  }
  return numero;
}

function validarPieza(valor: unknown, referencia: string): PiezaImportada {
  const pieza = objeto(valor, referencia);

  const ancho = decimal(pieza.ancho_mm, `Ancho de la ${referencia}`, {
    requerido: true,
    min: 0.01,
    max: 999_999.99,
  });
  const profundo = decimal(pieza.profundo_mm, `Profundo de la ${referencia}`, {
    requerido: true,
    min: 0.01,
    max: 999_999.99,
  });
  const dimensiones = textoOpcional(pieza.dimensiones, `Dimensiones de la ${referencia}`, {
    max: 100,
  });

  return {
    nombre_pieza: textoRequerido(pieza.nombre_pieza, `Nombre de la ${referencia}`, { max: 100 }),
    material: textoRequerido(pieza.material, `Material de la ${referencia}`, { max: 100 }),
    // The label is free text, but when the office does not send one it is
    // derived from the numbers so the sheet never shows an empty size.
    dimensiones: dimensiones ?? dimensionesDe(ancho, profundo),
    ancho_mm: ancho,
    profundo_mm: profundo,
    cantidad: enteroPositivo(pieza.cantidad, `Cantidad de la ${referencia}`, 1),
    requiere_lustre: booleano(pieza.requiere_lustre, false),
  };
}

function validarHerraje(valor: unknown, referencia: string): HerrajeImportado {
  const herraje = objeto(valor, referencia);

  return {
    herraje: textoRequerido(herraje.herraje, `Nombre del ${referencia}`, { max: 150 }),
    cantidad: enteroPositivo(herraje.cantidad, `Cantidad del ${referencia}`, 1),
    entregado_por_panol: booleano(herraje.entregado_por_panol, false),
  };
}

function validarModulos(valor: unknown): ModuloImportado[] {
  const crudos = lista(valor, "modulos");
  if (crudos.length > MAX_MODULOS) {
    throw new ApiError(400, `El despiece supera el máximo de ${MAX_MODULOS} módulos.`);
  }

  let totalPiezas = 0;
  let totalHerrajes = 0;

  return crudos.map((valorModulo, indice) => {
    const referencia = `módulo #${indice + 1}`;
    const modulo = objeto(valorModulo, referencia);
    const piezas = listaOpcional(modulo.piezas, `piezas del ${referencia}`);
    const herrajes = listaOpcional(modulo.herrajes, `herrajes del ${referencia}`);

    totalPiezas += piezas.length;
    if (totalPiezas > MAX_PIEZAS_TOTAL) {
      throw new ApiError(400, `El despiece supera el máximo de ${MAX_PIEZAS_TOTAL} piezas.`);
    }

    totalHerrajes += herrajes.length;
    if (totalHerrajes > MAX_HERRAJES) {
      throw new ApiError(400, `El despiece supera el máximo de ${MAX_HERRAJES} herrajes.`);
    }

    return {
      nombre: textoRequerido(modulo.nombre, `Nombre del ${referencia}`, { max: 150 }),
      piezas: piezas.map((pieza, i) => validarPieza(pieza, `pieza #${i + 1} del ${referencia}`)),
      herrajes: herrajes.map((herraje, i) =>
        validarHerraje(herraje, `herraje #${i + 1} del ${referencia}`),
      ),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Row shapes                                                                  */
/* -------------------------------------------------------------------------- */

interface OtRow {
  id: number;
  numero_ot: string;
  cliente: string;
  modelo: string | null;
  linea_area: string;
  estado_general: string;
  requiere_lustre: number;
}

interface ModuloRow {
  id: number;
  ot_id: number;
  nombre: string;
  numero_bulto: number;
}

interface PiezaRow {
  id: number;
  modulo_id: number;
  nombre_pieza: string;
  material: string;
  dimensiones: string;
  ancho_mm: number;
  profundo_mm: number;
  cantidad: number;
  cargado_en_flete: boolean;
  fecha_cargado: string | null;
  requiere_lustre: boolean;
}

interface HerrajeRow {
  id: number;
  modulo_id: number;
  herraje: string;
  cantidad: number;
  entregado_por_panol: boolean;
  fecha_entrega: string | null;
}

/** A dispatched piece/hardware row read before replacing the despiece. */
interface PiezaDespachadaRow {
  id: number;
  modulo: string;
  nombre_pieza: string;
  material: string;
  ancho_mm: number;
  profundo_mm: number;
  cantidad: number;
  cargado_en_flete: boolean;
  fecha_cargado: string | null;
}

interface HerrajeEntregadoRow {
  id: number;
  modulo: string;
  herraje: string;
  cantidad: number;
  fecha_entrega: string | null;
}

/* -------------------------------------------------------------------------- */
/* Matching (D3)                                                               */
/* -------------------------------------------------------------------------- */

function normalizar(texto: string): string {
  return texto.trim().replace(/\s+/g, " ").toLowerCase();
}

function milimetros(valor: number): string {
  return Number(valor).toFixed(2);
}

function clavePieza(modulo: string, pieza: Omit<PiezaImportada, "requiere_lustre" | "dimensiones">): string {
  return [
    normalizar(modulo),
    normalizar(pieza.nombre_pieza),
    normalizar(pieza.material),
    milimetros(pieza.ancho_mm),
    milimetros(pieza.profundo_mm),
    pieza.cantidad,
  ].join("\u0000");
}

function clavePiezaDespachada(fila: PiezaDespachadaRow): string {
  return clavePieza(fila.modulo, fila);
}

function claveHerraje(modulo: string, herraje: string, cantidad: number): string {
  return [normalizar(modulo), normalizar(herraje), cantidad].join("\u0000");
}

/**
 * FIFO queues of previous rows, indexed by physical identity.
 *
 * Two identical pieces keep their own state in the order they were stored: the
 * second new copy takes the second old state, not the first one twice.
 */
function crearCola<T>(previas: T[], clave: (previa: T) => string): Map<string, T[]> {
  const cola = new Map<string, T[]>();

  for (const previa of previas) {
    const indice = clave(previa);
    const lista = cola.get(indice);
    if (lista) lista.push(previa);
    else cola.set(indice, [previa]);
  }

  return cola;
}

/** Takes the next previous row with that identity, if any. */
function consumir<T>(cola: Map<string, T[]>, clave: string): T | undefined {
  const lista = cola.get(clave);
  return lista && lista.length > 0 ? lista.shift() : undefined;
}

/** Rows that nobody consumed: their floor state would be destroyed. */
function restantes<T>(cola: Map<string, T[]>): T[] {
  return [...cola.values()].flat();
}

/* -------------------------------------------------------------------------- */
/* Derived views (D6)                                                          */
/* -------------------------------------------------------------------------- */

async function resumenPlacasDe(c: Consultable, otId: number): Promise<ResumenPlaca[]> {
  const filas = await c.query<Fila<ResumenPlaca>>(
    `SELECT p.material,
            COUNT(*)::int AS filas,
            COALESCE(SUM(p.cantidad), 0)::int AS piezas,
            COALESCE(SUM(p.ancho_mm * p.profundo_mm * p.cantidad) / 1000000.0, 0) AS m2
       FROM ot_despiece_piezas p
       JOIN ot_despiece_modulos m ON m.id = p.modulo_id
      WHERE m.ot_id = $1
      GROUP BY p.material
      ORDER BY p.material;`,
    [otId],
  );

  return filas.rows.map((fila) => ({
    material: String(fila.material),
    filas: Number(fila.filas),
    piezas: Number(fila.piezas),
    m2: r3(Number(fila.m2)),
  }));
}

async function hojaHerrajesDe(c: Consultable, otId: number): Promise<HojaHerrajes> {
  const filas = await c.query<
    Fila<{
      modulo_id: number;
      nombre: string;
      numero_bulto: number;
      herraje_id: number | null;
      herraje: string | null;
      cantidad: number | null;
      entregado_por_panol: boolean | null;
      fecha_entrega: string | null;
    }>
  >(
    `SELECT m.id AS modulo_id, m.nombre, m.numero_bulto,
            h.id AS herraje_id, h.herraje, h.cantidad,
            h.entregado_por_panol, h.fecha_entrega
       FROM ot_despiece_modulos m
       LEFT JOIN ot_herrajes_lista h ON h.modulo_id = m.id
      WHERE m.ot_id = $1
      ORDER BY m.numero_bulto, h.id;`,
    [otId],
  );

  const modulos: HojaHerrajes["modulos"] = [];
  const porModulo = new Map<number, HojaHerrajes["modulos"][number]>();
  let items = 0;
  let unidades = 0;
  let entregados = 0;

  for (const fila of filas.rows) {
    const moduloId = Number(fila.modulo_id);
    let modulo = porModulo.get(moduloId);

    if (!modulo) {
      modulo = {
        modulo_id: moduloId,
        nombre: String(fila.nombre),
        numero_bulto: Number(fila.numero_bulto),
        herrajes: [],
      };
      porModulo.set(moduloId, modulo);
      modulos.push(modulo);
    }

    if (fila.herraje_id === null || fila.herraje === null) continue;

    const herraje: HerrajeDespiece = {
      id: Number(fila.herraje_id),
      modulo_id: moduloId,
      herraje: String(fila.herraje),
      cantidad: Number(fila.cantidad ?? 0),
      entregado_por_panol: Boolean(fila.entregado_por_panol),
      fecha_entrega: fila.fecha_entrega ?? null,
    };

    modulo.herrajes.push(herraje);
    items += 1;
    unidades += herraje.cantidad;
    if (herraje.entregado_por_panol) entregados += 1;
  }

  return {
    modulos,
    resumen: { items, unidades, entregados, pendientes: items - entregados },
  };
}

/** GET payload's plate view; exported for reports that only need the totals. */
export function obtenerResumenPlacas(otId: number): Promise<ResumenPlaca[]> {
  return resumenPlacasDe(getPool(), otId);
}

/** GET payload's hardware sheet; exported for the pañol printout. */
export function obtenerHojaHerrajes(otId: number): Promise<HojaHerrajes> {
  return hojaHerrajesDe(getPool(), otId);
}

/* -------------------------------------------------------------------------- */
/* Read                                                                        */
/* -------------------------------------------------------------------------- */

async function leerDespiece(c: Consultable, otId: number): Promise<DespieceCompleto> {
  // Sequential on purpose: `pg` deprecates running several queries at once on
  // the same client (they share one connection and one protocol stream). The
  // pool opens a connection per call, but a transaction client does not, and
  // this function is also used inside the import transaction.
  const otFila = await c.query<Fila<OtRow>>(
    `SELECT id, numero_ot, cliente, modelo, linea_area, estado_general, requiere_lustre
       FROM ordenes_trabajo
      WHERE id = $1;`,
    [otId],
  );

  const modulosFilas = await c.query<Fila<ModuloRow>>(
    `SELECT id, ot_id, nombre, numero_bulto
       FROM ot_despiece_modulos
      WHERE ot_id = $1
      ORDER BY numero_bulto, id;`,
    [otId],
  );

  const piezasFilas = await c.query<Fila<PiezaRow>>(
    `SELECT p.id, p.modulo_id, p.nombre_pieza, p.material, p.dimensiones,
            p.ancho_mm, p.profundo_mm, p.cantidad, p.cargado_en_flete,
            p.fecha_cargado, p.requiere_lustre
       FROM ot_despiece_piezas p
       JOIN ot_despiece_modulos m ON m.id = p.modulo_id
      WHERE m.ot_id = $1
      ORDER BY p.modulo_id, p.id;`,
    [otId],
  );

  const herrajesFilas = await c.query<Fila<HerrajeRow>>(
    `SELECT h.id, h.modulo_id, h.herraje, h.cantidad,
            h.entregado_por_panol, h.fecha_entrega
       FROM ot_herrajes_lista h
       JOIN ot_despiece_modulos m ON m.id = h.modulo_id
      WHERE m.ot_id = $1
      ORDER BY h.modulo_id, h.id;`,
    [otId],
  );

  const otRow = otFila.rows[0];
  if (!otRow) throw new ApiError(404, `No existe la OT con id ${otId}.`);

  const ot: DespieceOT = {
    id: Number(otRow.id),
    numero_ot: String(otRow.numero_ot),
    cliente: String(otRow.cliente),
    modelo: otRow.modelo ?? null,
    linea_area: String(otRow.linea_area),
    estado_general: String(otRow.estado_general),
    // `requiere_lustre` is smallint in `ordenes_trabajo`, not boolean.
    requiere_lustre: Number(otRow.requiere_lustre) === 1,
  };

  const porModulo = new Map<number, ModuloDespiece>();
  for (const fila of modulosFilas.rows) {
    porModulo.set(Number(fila.id), {
      id: Number(fila.id),
      ot_id: Number(fila.ot_id),
      nombre: String(fila.nombre),
      numero_bulto: Number(fila.numero_bulto),
      piezas: [],
      herrajes: [],
    });
  }

  for (const fila of piezasFilas.rows) {
    const modulo = porModulo.get(Number(fila.modulo_id));
    if (!modulo) continue;

    const pieza: PiezaDespiece = {
      id: Number(fila.id),
      modulo_id: Number(fila.modulo_id),
      nombre_pieza: String(fila.nombre_pieza),
      material: String(fila.material),
      dimensiones: String(fila.dimensiones),
      ancho_mm: Number(fila.ancho_mm),
      profundo_mm: Number(fila.profundo_mm),
      cantidad: Number(fila.cantidad),
      area_m2: areaPiezaM2({
        ancho_mm: Number(fila.ancho_mm),
        profundo_mm: Number(fila.profundo_mm),
        cantidad: Number(fila.cantidad),
      }),
      cargado_en_flete: Boolean(fila.cargado_en_flete),
      fecha_cargado: fila.fecha_cargado ?? null,
      requiere_lustre: Boolean(fila.requiere_lustre),
    };

    modulo.piezas.push(pieza);
  }

  for (const fila of herrajesFilas.rows) {
    const modulo = porModulo.get(Number(fila.modulo_id));
    if (!modulo) continue;

    modulo.herrajes.push({
      id: Number(fila.id),
      modulo_id: Number(fila.modulo_id),
      herraje: String(fila.herraje),
      cantidad: Number(fila.cantidad),
      entregado_por_panol: Boolean(fila.entregado_por_panol),
      fecha_entrega: fila.fecha_entrega ?? null,
    });
  }

  const modulos = [...porModulo.values()];
  // Same client again: run them one after the other, not concurrently.
  const resumen_placas = await resumenPlacasDe(c, otId);
  const hoja_herrajes = await hojaHerrajesDe(c, otId);

  return {
    ot,
    modulos,
    resumen_placas,
    hoja_herrajes,
    resumen: resumirDespiece(modulos),
  };
}

/** Full despiece of an OT. Throws 404 when the OT does not exist. */
export function obtenerDespiece(otId: number): Promise<DespieceCompleto> {
  return leerDespiece(getPool(), otId);
}

/* -------------------------------------------------------------------------- */
/* Import (D1-D4)                                                              */
/* -------------------------------------------------------------------------- */

/** Builds `INSERT ... VALUES ($1, ...), ($2, ...)` for a batch. */
function loteInsert(base: string, filas: unknown[][]): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const grupos: string[] = [];

  for (const fila of filas) {
    const marcas = fila.map((valor) => {
      params.push(valor);
      return `$${params.length}`;
    });
    grupos.push(`(${marcas.join(", ")})`);
  }

  return { sql: `${base} VALUES ${grupos.join(", ")};`, params };
}

/**
 * Replaces the despiece of an OT (D1/D2).
 *
 * The whole operation is one transaction under `LOCK_OT`: OT existence, the D3
 * guard, the replace-all and the lustre flag (D4) either all happen or none do.
 */
export async function importarDespiece(
  otId: number,
  modulosData: unknown,
): Promise<DespieceCompleto> {
  const modulos = validarModulos(modulosData);

  const existe = await query<Fila<{ id: number }>>(
    "SELECT id FROM ordenes_trabajo WHERE id = $1;",
    [otId],
  );
  if (!existe.rows[0]) throw new ApiError(404, `No existe la OT con id ${otId}.`);

  return withTransaction(
    async (client) => {
      // One client, one connection: sequential reads (see `leerDespiece`).
      const despachadas = await client.query<Fila<PiezaDespachadaRow>>(
        `SELECT p.id, m.nombre AS modulo, p.nombre_pieza, p.material,
                p.ancho_mm, p.profundo_mm, p.cantidad,
                p.cargado_en_flete, p.fecha_cargado
           FROM ot_despiece_piezas p
           JOIN ot_despiece_modulos m ON m.id = p.modulo_id
          WHERE m.ot_id = $1 AND p.cargado_en_flete = TRUE;`,
        [otId],
      );

      const entregados = await client.query<Fila<HerrajeEntregadoRow>>(
        `SELECT h.id, m.nombre AS modulo, h.herraje, h.cantidad, h.fecha_entrega
           FROM ot_herrajes_lista h
           JOIN ot_despiece_modulos m ON m.id = h.modulo_id
          WHERE m.ot_id = $1 AND h.entregado_por_panol = TRUE;`,
        [otId],
      );

      // D3: validate the replacement before touching a single row. Every piece
      // already loaded on a truck must still exist in the new import; otherwise
      // replacing would erase floor evidence, so the import is refused.
      const colaPiezasValidacion = crearCola(despachadas.rows, clavePiezaDespachada);
      for (const modulo of modulos) {
        for (const pieza of modulo.piezas) {
          consumir(colaPiezasValidacion, clavePieza(modulo.nombre, pieza));
        }
      }

      const piezasPerdidas = restantes(colaPiezasValidacion);
      if (piezasPerdidas.length > 0) {
        throw new ApiError(
          409,
          `La importación borraría ${piezasPerdidas.length} pieza(s) ya cargadas en flete.`,
          {
            accion:
              "Volvé a incluir esas piezas en el despiece o pedí a Control de Flete que las desmarque antes de reimportar.",
            piezas: piezasPerdidas
              .slice(0, 10)
              .map((fila) => `${fila.modulo} · ${fila.nombre_pieza}`),
          },
        );
      }

      const colaHerrajesValidacion = crearCola(
        entregados.rows,
        (fila) => claveHerraje(fila.modulo, fila.herraje, fila.cantidad),
      );
      for (const modulo of modulos) {
        for (const herraje of modulo.herrajes) {
          consumir(
            colaHerrajesValidacion,
            claveHerraje(modulo.nombre, herraje.herraje, herraje.cantidad),
          );
        }
      }

      const herrajesPerdidos = restantes(colaHerrajesValidacion);
      if (herrajesPerdidos.length > 0) {
        throw new ApiError(
          409,
          `La importación borraría ${herrajesPerdidos.length} herraje(s) ya entregados por el pañol.`,
          {
            accion:
              "Volvé a incluir esos herrajes en el despiece o pedí al pañol que revierta la entrega antes de reimportar.",
            herrajes: herrajesPerdidos
              .slice(0, 10)
              .map((fila) => `${fila.modulo} · ${fila.herraje}`),
          },
        );
      }

      // D1/D2: replace-all. Children follow by ON DELETE CASCADE, so there is
      // no window where a module exists without its pieces.
      await client.query("DELETE FROM ot_despiece_modulos WHERE ot_id = $1;", [otId]);

      const ahora = ahoraUTC();
      let numeroBulto = 0;
      let hayLaqueado = false;

      // Fresh queues: the validation pass above consumed the first ones.
      const colaPiezas = crearCola(despachadas.rows, clavePiezaDespachada);
      const colaHerrajes = crearCola(
        entregados.rows,
        (fila) => claveHerraje(fila.modulo, fila.herraje, fila.cantidad),
      );

      const filasPiezas: unknown[][] = [];
      const filasHerrajes: unknown[][] = [];

      const volcarPiezas = async () => {
        if (filasPiezas.length === 0) return;

        const lote = loteInsert(
          `INSERT INTO ot_despiece_piezas
             (modulo_id, nombre_pieza, material, dimensiones, ancho_mm, profundo_mm,
              cantidad, cargado_en_flete, requiere_lustre, fecha_cargado,
              fecha_creacion, fecha_actualizacion)`,
          filasPiezas.splice(0, filasPiezas.length),
        );
        await client.query(lote.sql, lote.params);
      };

      const volcarHerrajes = async () => {
        if (filasHerrajes.length === 0) return;

        const lote = loteInsert(
          `INSERT INTO ot_herrajes_lista
             (modulo_id, herraje, cantidad, entregado_por_panol, fecha_entrega,
              fecha_creacion, fecha_actualizacion)`,
          filasHerrajes.splice(0, filasHerrajes.length),
        );
        await client.query(lote.sql, lote.params);
      };

      for (const modulo of modulos) {
        numeroBulto += 1;

        const insertado = await client.query<Fila<{ id: number }>>(
          `INSERT INTO ot_despiece_modulos
             (ot_id, nombre, numero_bulto, fecha_creacion, fecha_actualizacion)
           VALUES ($1, $2, $3, $4, $4)
           RETURNING id;`,
          [otId, modulo.nombre, numeroBulto, ahora],
        );
        const moduloId = Number(insertado.rows[0].id);

        for (const pieza of modulo.piezas) {
          // Only dispatched rows were queued, so a match means "already on a
          // truck": its flag and date survive the replace-all.
          const previa = consumir(colaPiezas, clavePieza(modulo.nombre, pieza));
          const cargado = Boolean(previa);

          if (pieza.requiere_lustre) hayLaqueado = true;

          filasPiezas.push([
            moduloId,
            pieza.nombre_pieza,
            pieza.material,
            pieza.dimensiones,
            pieza.ancho_mm,
            pieza.profundo_mm,
            pieza.cantidad,
            cargado,
            pieza.requiere_lustre,
            cargado ? (previa?.fecha_cargado ?? ahora) : null,
            ahora,
            ahora,
          ]);

          if (filasPiezas.length >= MAX_LOTE) await volcarPiezas();
        }

        for (const herraje of modulo.herrajes) {
          const previo = consumir(
            colaHerrajes,
            claveHerraje(modulo.nombre, herraje.herraje, herraje.cantidad),
          );
          const entregado = Boolean(previo);

          filasHerrajes.push([
            moduloId,
            herraje.herraje,
            herraje.cantidad,
            entregado,
            entregado ? (previo?.fecha_entrega ?? ahora) : null,
            ahora,
            ahora,
          ]);

          if (filasHerrajes.length >= MAX_LOTE) await volcarHerrajes();
        }
      }

      await volcarPiezas();
      await volcarHerrajes();

      // D4: only turns the flag on. Turning it off could remove a lustre that
      // was requested by another path; a planner can still clear it manually.
      if (hayLaqueado) {
        await client.query(
          `UPDATE ordenes_trabajo
              SET requiere_lustre = 1, fecha_actualizacion = $2
            WHERE id = $1;`,
          [otId, ahora],
        );
      }

      return leerDespiece(client, otId);
    },
    [[LOCK_OT, otId]],
  );
}

/* -------------------------------------------------------------------------- */
/* Dispatch toggles                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Marks a piece as loaded on the truck, or toggles it when `cargado` is null.
 *
 * A truck-loading operator does this from the floor, so it is not a management
 * action. The OT lock keeps a toggle from racing a concurrent re-import, which
 * would write the flag onto a row that no longer exists.
 */
export async function marcarPieza(
  id: number,
  cargado: boolean | null,
): Promise<ResultadoPieza> {
  const ubicacion = await query<Fila<{ ot_id: number }>>(
    `SELECT m.ot_id
       FROM ot_despiece_piezas p
       JOIN ot_despiece_modulos m ON m.id = p.modulo_id
      WHERE p.id = $1;`,
    [id],
  );

  const otId = ubicacion.rows[0] ? Number(ubicacion.rows[0].ot_id) : null;
  if (otId === null) throw new ApiError(404, `No existe la pieza de despiece con id ${id}.`);

  return withTransaction(
    async (client) => {
      const actual = await client.query<Fila<{ cargado_en_flete: boolean }>>(
        `SELECT cargado_en_flete
           FROM ot_despiece_piezas
          WHERE id = $1
          FOR UPDATE;`,
        [id],
      );

      const fila = actual.rows[0];
      if (!fila) throw new ApiError(404, `No existe la pieza de despiece con id ${id}.`);

      const nuevo = cargado === null ? !fila.cargado_en_flete : cargado;
      const ahora = ahoraUTC();

      await client.query(
        `UPDATE ot_despiece_piezas
            SET cargado_en_flete = $1, fecha_cargado = $2, fecha_actualizacion = $3
          WHERE id = $4;`,
        [nuevo, nuevo ? ahora : null, ahora, id],
      );

      return {
        id,
        ot_id: otId,
        cargado_en_flete: nuevo,
        fecha_cargado: nuevo ? ahora : null,
      };
    },
    [[LOCK_OT, otId]],
  );
}

/** Marks hardware as delivered by the pañol, or toggles it when null. */
export async function marcarHerraje(
  id: number,
  entregado: boolean | null,
): Promise<ResultadoHerraje> {
  const ubicacion = await query<Fila<{ ot_id: number }>>(
    `SELECT m.ot_id
       FROM ot_herrajes_lista h
       JOIN ot_despiece_modulos m ON m.id = h.modulo_id
      WHERE h.id = $1;`,
    [id],
  );

  const otId = ubicacion.rows[0] ? Number(ubicacion.rows[0].ot_id) : null;
  if (otId === null) throw new ApiError(404, `No existe el herraje con id ${id}.`);

  return withTransaction(
    async (client) => {
      const actual = await client.query<Fila<{ entregado_por_panol: boolean }>>(
        `SELECT entregado_por_panol
           FROM ot_herrajes_lista
          WHERE id = $1
          FOR UPDATE;`,
        [id],
      );

      const fila = actual.rows[0];
      if (!fila) throw new ApiError(404, `No existe el herraje con id ${id}.`);

      const nuevo = entregado === null ? !fila.entregado_por_panol : entregado;
      const ahora = ahoraUTC();

      await client.query(
        `UPDATE ot_herrajes_lista
            SET entregado_por_panol = $1, fecha_entrega = $2, fecha_actualizacion = $3
          WHERE id = $4;`,
        [nuevo, nuevo ? ahora : null, ahora, id],
      );

      return {
        id,
        ot_id: otId,
        entregado_por_panol: nuevo,
        fecha_entrega: nuevo ? ahora : null,
      };
    },
    [[LOCK_OT, otId]],
  );
}
