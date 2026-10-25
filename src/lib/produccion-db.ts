import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { lockKey } from "@/lib/auth";
import { LOCK_OPERATOR, LOCK_OT, LOCK_SECTOR, query, withTransaction } from "@/lib/db";
import { ApiError } from "@/lib/http";
import {
  type AlertaNoConformidad,
  type ContextoMateriales,
  type DetalleOrden,
  type EstadoEtapa,
  type EstadoOT,
  type LineaOT,
  type MaterialOT,
  type MaterialRow,
  type MotivoPausa,
  type Operario,
  type OperarioRow,
  type OrdenConProgreso,
  type OrdenRow,
  type OrdenTrabajo,
  type RegistroRow,
  type RegistroTiempo,
  type Sector,
  type SectorRow,
  ahoraUTC,
  calcularDuracionMinutos,
  claveNormalizada,
  construirOT,
  indexarEtapas,
  mapMaterial,
  mapOT,
  mapOperario,
  mapRegistro,
  mapSector,
  prerrequisitosSector,
  requiereEspecial,
  resumenMateriales,
  sectorAplica,
  sectoresRequeridos,
} from "@/lib/produccion";

/*
 * SQL access for the plant terminal.
 *
 * Route handlers stay thin: they validate input and translate errors. This
 * module owns the queries, the transactions and the advisory locks.
 */

type Fila<T> = T & QueryResultRow;

/** Anything that can run a parameterised query (pool or transaction client). */
type Ejecutor = <T extends QueryResultRow>(
  sql: string,
  params?: unknown[],
) => Promise<QueryResult<T>>;

const ABIERTOS_SQL = "('En Proceso','Pausado')";

function ejecutorDe(client?: PoolClient): Ejecutor {
  if (!client) return query;
  return <T extends QueryResultRow>(sql: string, params: unknown[] = []) =>
    client.query<T>(sql, params);
}

function esViolacionUnica(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function jsonArray(valor: unknown): unknown[] {
  if (Array.isArray(valor)) return valor;
  if (typeof valor === "string") {
    try {
      const parseado: unknown = JSON.parse(valor);
      return Array.isArray(parseado) ? parseado : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function cargarSectores(ejecutar: Ejecutor = query): Promise<Sector[]> {
  const filas = await ejecutar<Fila<SectorRow>>("SELECT * FROM sectores ORDER BY id;");
  return filas.rows.map(mapSector);
}

/** Ids of the sectors an order has already finished. */
async function sectoresFinalizados(otId: number, ejecutar: Ejecutor = query): Promise<Set<number>> {
  const filas = await ejecutar<Fila<{ sector_id: number }>>(
    `SELECT DISTINCT sector_id
       FROM registros_tiempos
      WHERE ot_id = $1 AND estado_etapa = 'Finalizado';`,
    [otId],
  );

  return new Set(filas.rows.map((fila) => Number(fila.sector_id)));
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listarSectores(incluirInactivos: boolean): Promise<Sector[]> {
  const filas = await query<Fila<SectorRow>>(
    `SELECT *
       FROM sectores
      ${incluirInactivos ? "" : "WHERE activo = 1"}
      ORDER BY CASE linea_area
                 WHEN 'Placares'   THEN 0
                 WHEN 'Cocinas'    THEN 1
                 WHEN 'Compartido' THEN 2
                 ELSE 3
               END,
               orden_flujo ASC, id ASC;`,
  );

  // Live activity: how many stages are open in each sector right now.
  const actividad = await query<
    Fila<{ sector_id: number; abiertas: number; ordenes: string | null }>
  >(
    `SELECT r.sector_id,
            COUNT(*) AS abiertas,
            string_agg(DISTINCT o.numero_ot, ',') AS ordenes
       FROM registros_tiempos r
       JOIN ordenes_trabajo o ON o.id = r.ot_id
      WHERE r.estado_etapa IN ${ABIERTOS_SQL}
      GROUP BY r.sector_id;`,
  );

  const porId = new Map(actividad.rows.map((fila) => [Number(fila.sector_id), fila]));

  return filas.rows.map((row) => {
    const sector = mapSector(row);
    const viva = porId.get(sector.id);

    return {
      ...sector,
      etapas_abiertas: viva ? Number(viva.abiertas) : 0,
      ordenes_activas: viva ? String(viva.ordenes ?? "").split(",").filter(Boolean) : [],
    };
  });
}

export async function listarOperarios(incluirInactivos: boolean): Promise<Operario[]> {
  const where = incluirInactivos ? "" : "WHERE op.activo = 1";

  const filas = await query<Fila<OperarioRow>>(
    `SELECT op.id, op.nombre, op.activo, op.fecha_creacion,
            COALESCE(r.etapas, 0)   AS etapas,
            COALESCE(r.abiertas, 0) AS etapas_abiertas,
            r.ultima
       FROM operarios op
       LEFT JOIN (
         SELECT op2.id AS op_id,
                COUNT(r2.id) AS etapas,
                SUM(CASE WHEN r2.estado_etapa IN ${ABIERTOS_SQL} THEN 1 ELSE 0 END) AS abiertas,
                MAX(r2.fecha_hora_inicio) AS ultima
           FROM operarios op2
           JOIN registros_tiempos r2 ON lower(r2.operario_nombre) = lower(op2.nombre)
          GROUP BY op2.id
       ) r ON r.op_id = op.id
       ${where}
      ORDER BY op.activo DESC, lower(op.nombre) ASC
      LIMIT 500;`,
  );

  return filas.rows.map(mapOperario);
}

export interface FiltrosOrdenes {
  estado?: string;
  linea?: string;
  texto?: string;
  /** Include finished orders. Ignored when `estado` is given. */
  todos?: boolean;
}

/*
 * Anti N+1: the list always makes THREE round trips regardless of how many
 * orders it returns.
 *   1. Orders + the whole sector catalog (one query with `json_agg`).
 *   2. Stage rows for every order (`ot_id = ANY($1)`).
 *   3. Materials + non-conformities for every order (`ot_id = ANY($1)`).
 * The cross-referencing afterwards is pure CPU over Maps indexed by `ot_id`.
 */

function filtrosSQL(filtros: FiltrosOrdenes): { whereSql: string; params: unknown[] } {
  const condiciones: string[] = [];
  const params: unknown[] = [];

  if (filtros.estado) {
    params.push(filtros.estado);
    condiciones.push(`o.estado_general = $${params.length}`);
  } else if (!filtros.todos) {
    condiciones.push("o.estado_general <> 'Finalizado'");
  }

  if (filtros.linea) {
    params.push(filtros.linea);
    condiciones.push(`o.linea_area = $${params.length}`);
  }

  if (filtros.texto) {
    params.push(`%${filtros.texto}%`);
    const posicion = params.length;
    condiciones.push(
      `(o.numero_ot ILIKE $${posicion} OR o.cliente ILIKE $${posicion} OR o.modelo ILIKE $${posicion})`,
    );
  }

  return {
    whereSql: condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "",
    params,
  };
}

async function cargarSectoresYOrdenes(
  filtros: FiltrosOrdenes,
): Promise<{ sectores: Sector[]; ordenes: OrdenTrabajo[] }> {
  const { whereSql, params } = filtrosSQL(filtros);

  const resultado = await query<Fila<{ sectores: unknown; ordenes: unknown }>>(
    `WITH ots AS (
       SELECT o.*,
              row_number() OVER (
                ORDER BY
                  CASE o.estado_general
                    WHEN 'En Producción' THEN 0
                    WHEN 'Detenido'      THEN 1
                    WHEN 'En Cola'       THEN 2
                    ELSE 3
                  END,
                  o.fecha_prometida IS NULL, o.fecha_prometida, o.numero_ot DESC
              ) AS __orden
         FROM ordenes_trabajo o
         ${whereSql}
     )
     SELECT
       COALESCE((SELECT json_agg(s ORDER BY s.id) FROM sectores s), '[]'::json) AS sectores,
       COALESCE((SELECT json_agg(o ORDER BY o.__orden) FROM ots o), '[]'::json) AS ordenes;`,
    params,
  );

  const fila = resultado.rows[0];

  return {
    sectores: jsonArray(fila?.sectores).map((item) => mapSector(item as SectorRow)),
    ordenes: jsonArray(fila?.ordenes).map((item) => mapOT(item as OrdenRow)),
  };
}

async function cargarEtapas(otIds: number[]): Promise<RegistroRow[]> {
  const filas = await query<Fila<RegistroRow>>(
    `SELECT r.id, r.ot_id, r.sector_id, r.estado_etapa, r.operario_nombre,
            r.fecha_hora_inicio, r.fecha_hora_fin, r.pausa_inicio,
            r.segundos_pausados, r.duracion_minutos, r.motivo_pausa, r.observacion,
            s.nombre_sector, s.nombre_corto
       FROM registros_tiempos r
       JOIN sectores s ON s.id = r.sector_id
      WHERE r.ot_id = ANY($1::bigint[])
      ORDER BY r.ot_id, r.fecha_hora_inicio DESC, r.id DESC;`,
    [otIds],
  );

  return filas.rows;
}

async function cargarMaterialesYAlertas(otIds: number[]): Promise<Map<number, ContextoMateriales>> {
  const filas = await query<Fila<{ ot_id: number; materiales: unknown; alertas: unknown }>>(
    `WITH mats AS (
       SELECT m.ot_id, json_agg(m ORDER BY m.id) AS materiales
         FROM ot_materiales m
        WHERE m.ot_id = ANY($1::bigint[])
        GROUP BY m.ot_id
     ),
     ncs AS (
       SELECT nc.ot_id,
              json_agg(json_build_object(
                'id', nc.id,
                'ot_id', nc.ot_id,
                'sector_id', nc.sector_id,
                'nombre_sector', s.nombre_sector,
                'tipo_falla', nc.tipo_falla,
                'estado', nc.estado,
                'accion_correctiva', nc.accion_correctiva,
                'fecha_registro', nc.fecha_registro
              ) ORDER BY nc.fecha_registro DESC, nc.id DESC) AS alertas
         FROM no_conformidades nc
         LEFT JOIN sectores s ON s.id = nc.sector_id
        WHERE nc.ot_id = ANY($1::bigint[])
          AND nc.estado <> 'Descartado'
        GROUP BY nc.ot_id
     )
     SELECT COALESCE(m.ot_id, n.ot_id) AS ot_id,
            COALESCE(m.materiales, '[]'::json) AS materiales,
            COALESCE(n.alertas, '[]'::json) AS alertas
       FROM mats m
       FULL OUTER JOIN ncs n ON n.ot_id = m.ot_id;`,
    [otIds],
  );

  const mapa = new Map<number, ContextoMateriales>();

  for (const fila of filas.rows) {
    mapa.set(Number(fila.ot_id), {
      materiales: jsonArray(fila.materiales).map((item) => mapMaterial(item as MaterialRow)),
      alertas: jsonArray(fila.alertas).map((item) => item as AlertaNoConformidad),
    });
  }

  return mapa;
}

/** Orders of the plant, enriched with progress, in three round trips. */
export async function listarOrdenes(filtros: FiltrosOrdenes = {}): Promise<OrdenConProgreso[]> {
  const { sectores, ordenes } = await cargarSectoresYOrdenes(filtros);
  if (ordenes.length === 0) return [];

  const ids = ordenes.map((ot) => ot.id);

  const [etapas, materiales] = await Promise.all([
    cargarEtapas(ids),
    cargarMaterialesYAlertas(ids),
  ]);

  const etapasPorOT = indexarEtapas(etapas);

  return ordenes.map((ot) =>
    construirOT(ot, sectores, {
      etapas: etapasPorOT.get(ot.id),
      materiales: materiales.get(ot.id),
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Order detail                                                                */
/* -------------------------------------------------------------------------- */

export type { DetalleOrden };

/** Order + sector catalog in ONE round trip (the same trick `listarOrdenes` uses). */
async function cargarOrdenConSectores(
  id: number,
): Promise<{ ot: OrdenTrabajo; sectores: Sector[] } | null> {
  const resultado = await query<Fila<{ sectores: unknown; orden: unknown }>>(
    `SELECT
       COALESCE((SELECT json_agg(s ORDER BY s.id) FROM sectores s), '[]'::json) AS sectores,
       (SELECT to_jsonb(o) FROM ordenes_trabajo o WHERE o.id = $1) AS orden;`,
    [id],
  );

  const fila = resultado.rows[0];
  if (!fila?.orden) return null;

  return {
    ot: mapOT(fila.orden as OrdenRow),
    sectores: jsonArray(fila.sectores).map((item) => mapSector(item as SectorRow)),
  };
}

/**
 * Everything the detail screen needs, in THREE round trips: (1) order + sectors,
 * (2+3) stage history and materials/non-conformities in parallel. Mirrors the
 * legacy `cargarOTPorId` + `cargarRegistros` + `cargarMaterialesYAlertas`.
 */
export async function obtenerOrden(id: number): Promise<DetalleOrden | null> {
  const base = await cargarOrdenConSectores(id);
  if (!base) return null;

  const [registrosFilas, materiales] = await Promise.all([
    cargarEtapas([id]),
    cargarMaterialesYAlertas([id]),
  ]);

  const etapas = indexarEtapas(registrosFilas);

  return {
    ot: construirOT(base.ot, base.sectores, {
      etapas: etapas.get(id),
      materiales: materiales.get(id),
    }),
    registros: registrosFilas.map(mapRegistro),
    sectores: base.sectores,
  };
}

/* -------------------------------------------------------------------------- */
/* Order writes                                                                */
/* -------------------------------------------------------------------------- */

export interface DatosNuevaOrden {
  numero_ot: string;
  cliente: string;
  modelo: string | null;
  linea_area: LineaOT;
  metros_lineales: number;
  fecha_prometida: string | null;
  requiere_vidrio: boolean;
  requiere_lustre: boolean;
  requiere_herreria: boolean;
  requiere_especiales: boolean;
  estado_general: EstadoOT;
}

/** Inserts an order. A duplicate number is a 409, never a 500. */
export async function crearOrden(datos: DatosNuevaOrden): Promise<OrdenTrabajo> {
  const ahora = ahoraUTC();

  try {
    const filas = await query<Fila<OrdenRow>>(
      `INSERT INTO ordenes_trabajo
         (numero_ot, cliente, modelo, linea_area, metros_lineales, fecha_prometida,
          requiere_vidrio, requiere_lustre, requiere_herreria, requiere_especiales,
          estado_general, fecha_creacion, fecha_actualizacion)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
       RETURNING *;`,
      [
        datos.numero_ot,
        datos.cliente,
        datos.modelo,
        datos.linea_area,
        datos.metros_lineales,
        datos.fecha_prometida,
        datos.requiere_vidrio ? 1 : 0,
        datos.requiere_lustre ? 1 : 0,
        datos.requiere_herreria ? 1 : 0,
        datos.requiere_especiales ? 1 : 0,
        datos.estado_general,
        ahora,
      ],
    );

    return mapOT(filas.rows[0]);
  } catch (error) {
    if (esViolacionUnica(error)) {
      throw new ApiError(409, `La ${datos.numero_ot} ya está cargada en el sistema.`, {
        accion: "Verifique el número de OT: debe ser único.",
      });
    }
    throw error;
  }
}

/** Only the fields the client actually sent; absent ones keep their stored value. */
export interface CambiosOrden {
  numero_ot?: string;
  cliente?: string;
  modelo?: string | null;
  linea_area?: LineaOT;
  metros_lineales?: number;
  fecha_prometida?: string | null;
  requiere_vidrio?: boolean;
  requiere_lustre?: boolean;
  requiere_herreria?: boolean;
  requiere_especiales?: boolean;
  estado_general?: EstadoOT;
}

/**
 * Updates an order under the OT advisory lock + `SELECT … FOR UPDATE`.
 *
 * Changing `linea_area` re-scopes the whole flow (which sectors are required
 * and in what order), so it is rejected once any stage has been finished: the
 * progress and the historical reports would no longer line up.
 */
export async function actualizarOrden(id: number, cambios: CambiosOrden): Promise<DetalleOrden> {
  const ahora = ahoraUTC();

  try {
    await withTransaction(
      async (client) => {
        const actualFila = await client.query<Fila<OrdenRow>>(
          "SELECT * FROM ordenes_trabajo WHERE id = $1 FOR UPDATE;",
          [id],
        );
        const fila = actualFila.rows[0];
        if (!fila) throw new ApiError(404, `No existe la OT con id ${id}.`);

        const actual = mapOT(fila);
        const nuevo = {
          numero_ot: cambios.numero_ot ?? actual.numero_ot,
          cliente: cambios.cliente ?? actual.cliente,
          modelo: cambios.modelo !== undefined ? cambios.modelo : actual.modelo,
          linea_area: cambios.linea_area ?? actual.linea_area,
          metros_lineales: cambios.metros_lineales ?? actual.metros_lineales,
          fecha_prometida:
            cambios.fecha_prometida !== undefined
              ? cambios.fecha_prometida
              : actual.fecha_prometida,
          requiere_vidrio: cambios.requiere_vidrio ?? actual.requiere_vidrio,
          requiere_lustre: cambios.requiere_lustre ?? actual.requiere_lustre,
          requiere_herreria: cambios.requiere_herreria ?? actual.requiere_herreria,
          requiere_especiales: cambios.requiere_especiales ?? actual.requiere_especiales,
          estado_general: cambios.estado_general ?? actual.estado_general,
        };

        const duplicada = await client.query<Fila<{ numero_ot: string }>>(
          `SELECT numero_ot FROM ordenes_trabajo
            WHERE upper(numero_ot) = upper($1) AND id <> $2
            LIMIT 1;`,
          [nuevo.numero_ot, id],
        );
        if (duplicada.rows[0]) {
          throw new ApiError(409, `La ${duplicada.rows[0].numero_ot} ya está cargada en el sistema.`);
        }

        if (nuevo.linea_area !== actual.linea_area) {
          const cerradas = await client.query<Fila<{ n: number }>>(
            `SELECT COUNT(*)::int AS n
               FROM registros_tiempos
              WHERE ot_id = $1 AND estado_etapa = 'Finalizado';`,
            [id],
          );
          const total = Number(cerradas.rows[0]?.n ?? 0);

          if (total > 0) {
            throw new ApiError(
              409,
              `La ${actual.numero_ot} ya tiene ${total} etapa(s) finalizada(s): no se puede cambiar ` +
                `de línea (${actual.linea_area} → ${nuevo.linea_area}) sin romper el progreso y los ` +
                "reportes históricos.",
              {
                accion:
                  "Cree una OT nueva en la línea correcta, o elimínela y recárguela antes de producir.",
              },
            );
          }
        }

        await client.query(
          `UPDATE ordenes_trabajo SET
             numero_ot = $1, cliente = $2, modelo = $3, linea_area = $4, metros_lineales = $5,
             fecha_prometida = $6, requiere_vidrio = $7, requiere_lustre = $8,
             requiere_herreria = $9, requiere_especiales = $10, estado_general = $11,
             fecha_actualizacion = $12
           WHERE id = $13;`,
          [
            nuevo.numero_ot,
            nuevo.cliente,
            nuevo.modelo,
            nuevo.linea_area,
            nuevo.metros_lineales,
            nuevo.fecha_prometida,
            nuevo.requiere_vidrio ? 1 : 0,
            nuevo.requiere_lustre ? 1 : 0,
            nuevo.requiere_herreria ? 1 : 0,
            nuevo.requiere_especiales ? 1 : 0,
            nuevo.estado_general,
            ahora,
            id,
          ],
        );
      },
      [[LOCK_OT, id]],
    );
  } catch (error) {
    if (esViolacionUnica(error)) {
      throw new ApiError(409, "Ya existe una OT con ese número.", {
        accion: "Verifique el número de OT: debe ser único.",
      });
    }
    throw error;
  }

  const detalle = await obtenerOrden(id);
  if (!detalle) throw new ApiError(404, `No existe la OT con id ${id}.`);

  return detalle;
}

/* -------------------------------------------------------------------------- */
/* Materials                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One row of the full-replace payload.
 *
 * Rows with `id` are updates: any field left `undefined` keeps its stored value
 * (the consumption UI only sends `id` + `cantidad_consumida`). Rows without
 * `id` are inserts and must carry a name and a plate count.
 */
export interface MaterialEntrada {
  id: number | null;
  material_nombre?: string | null;
  cantidad_placas?: number;
  cantidad_consumida?: number;
  observaciones?: string | null;
}

export interface ResultadoMateriales {
  materiales: MaterialOT[];
  resumen_materiales: ReturnType<typeof resumenMateriales>;
}

/**
 * Full replace of an order's material list (PUT semantics).
 *
 * Everything happens in one transaction with the OT advisory lock and the order
 * row locked: the consumed ≤ required invariant is checked AFTER merging each
 * row with its stored values, so a client sending only the consumption can
 * never smuggle a value above the requirement.
 */
export async function reemplazarMateriales(
  otId: number,
  entradas: MaterialEntrada[],
): Promise<ResultadoMateriales> {
  const ahora = ahoraUTC();

  await withTransaction(
    async (client) => {
      const ot = await client.query<Fila<{ id: number }>>(
        "SELECT id FROM ordenes_trabajo WHERE id = $1 FOR UPDATE;",
        [otId],
      );
      if (!ot.rows[0]) throw new ApiError(404, `No existe la OT con id ${otId}.`);

      const existentesFilas = await client.query<Fila<MaterialRow>>(
        "SELECT * FROM ot_materiales WHERE ot_id = $1 ORDER BY id;",
        [otId],
      );
      const existentes = new Map<number, MaterialOT>(
        existentesFilas.rows.map((fila) => [Number(fila.id), mapMaterial(fila)]),
      );

      const conservados = new Set<number>();
      const nombres = new Map<string, number>();
      const fusionadas: Array<{
        id: number | null;
        nombre: string;
        placas: number;
        consumidas: number;
        observaciones: string | null;
      }> = [];

      entradas.forEach((entrada, indice) => {
        const posicion = indice + 1;
        const base = entrada.id === null ? null : (existentes.get(entrada.id) ?? null);

        if (entrada.id !== null && !base) {
          throw new ApiError(
            400,
            `El material con id ${entrada.id} no pertenece a la OT ${otId}.`,
          );
        }
        if (entrada.id !== null) conservados.add(entrada.id);

        const nombre = base
          ? (entrada.material_nombre ?? base.material_nombre)
          : entrada.material_nombre;
        if (!nombre) {
          throw new ApiError(400, `Material #${posicion}: el nombre es obligatorio.`);
        }

        const placas = base ? (entrada.cantidad_placas ?? base.cantidad_placas) : entrada.cantidad_placas;
        if (placas === undefined) {
          throw new ApiError(400, `Material #${posicion}: la cantidad de placas es obligatoria.`);
        }

        const consumidas = base
          ? (entrada.cantidad_consumida ?? base.cantidad_consumida)
          : (entrada.cantidad_consumida ?? 0);

        if (consumidas > placas) {
          throw new ApiError(
            400,
            `Material "${nombre}": las placas consumidas (${consumidas}) no pueden superar ` +
              `las requeridas (${placas}).`,
          );
        }

        const observaciones =
          entrada.observaciones !== undefined
            ? entrada.observaciones
            : (base?.observaciones ?? null);

        const clave = nombre.toLowerCase();
        const repetido = nombres.get(clave);
        if (repetido !== undefined) {
          throw new ApiError(
            400,
            `El material "${nombre}" está repetido (aparece en las filas ${repetido} y ` +
              `${posicion}). Junte las cantidades en una sola fila.`,
          );
        }
        nombres.set(clave, posicion);

        fusionadas.push({
          id: entrada.id,
          nombre,
          placas,
          consumidas,
          observaciones: observaciones ?? null,
        });
      });

      for (const fila of fusionadas) {
        if (fila.id === null) continue;

        await client.query(
          `UPDATE ot_materiales
              SET material_nombre = $1, cantidad_placas = $2, cantidad_consumida = $3,
                  observaciones = $4, fecha_actualizacion = $5
            WHERE id = $6 AND ot_id = $7;`,
          [fila.nombre, fila.placas, fila.consumidas, fila.observaciones, ahora, fila.id, otId],
        );
      }

      for (const fila of fusionadas) {
        if (fila.id !== null) continue;

        await client.query(
          `INSERT INTO ot_materiales
             (ot_id, material_nombre, cantidad_placas, cantidad_consumida, observaciones,
              fecha_creacion, fecha_actualizacion)
           VALUES ($1, $2, $3, $4, $5, $6, $6);`,
          [otId, fila.nombre, fila.placas, fila.consumidas, fila.observaciones, ahora],
        );
      }

      const borrar = [...existentes.keys()].filter((id) => !conservados.has(id));
      if (borrar.length > 0) {
        await client.query("DELETE FROM ot_materiales WHERE ot_id = $1 AND id = ANY($2::bigint[]);", [
          otId,
          borrar,
        ]);
      }
    },
    [[LOCK_OT, otId]],
  );

  const filas = await query<Fila<MaterialRow>>(
    "SELECT * FROM ot_materiales WHERE ot_id = $1 ORDER BY id;",
    [otId],
  );
  const materiales = filas.rows.map(mapMaterial);

  return { materiales, resumen_materiales: resumenMateriales(materiales) };
}

/* -------------------------------------------------------------------------- */
/* Operator master (rule O2)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Ensures the operator exists in the master table.
 *
 * Unknown names are auto-registered as active so a forgotten entry never
 * blocks the plant. Returns the CANONICAL spelling: the stage must store that
 * one, not whatever was typed, so per-operator metrics stay joined.
 */
export async function asegurarOperario(nombre: string): Promise<{ id: number; nombre: string }> {
  const norm = claveNormalizada(nombre);

  const existente = await query<Fila<{ id: number; nombre: string; activo: number }>>(
    "SELECT id, nombre, activo FROM operarios WHERE nombre_norm = $1;",
    [norm],
  );
  const fila = existente.rows[0];

  if (fila) {
    if (!fila.activo) {
      throw new ApiError(
        409,
        `El operario "${nombre}" está DESACTIVADO en el maestro y no puede iniciar etapas.`,
        { accion: "Reactívelo desde Administración → Operarios o utilice otro operario." },
      );
    }
    return { id: Number(fila.id), nombre: fila.nombre };
  }

  try {
    const alta = await query<Fila<{ id: number }>>(
      `INSERT INTO operarios (nombre, nombre_norm, activo, fecha_creacion)
       VALUES ($1, $2, 1, $3) RETURNING id;`,
      [nombre, norm, ahoraUTC()],
    );
    return { id: Number(alta.rows[0].id), nombre };
  } catch (error) {
    // Concurrent high of the same name: another request won the race.
    if (esViolacionUnica(error)) {
      const ganador = await query<Fila<{ id: number; nombre: string }>>(
        "SELECT id, nombre FROM operarios WHERE nombre_norm = $1;",
        [norm],
      );
      if (ganador.rows[0]) {
        return { id: Number(ganador.rows[0].id), nombre: ganador.rows[0].nombre };
      }
    }
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Stage actions                                                               */
/* -------------------------------------------------------------------------- */

async function registroConJoin(id: number): Promise<RegistroTiempo | null> {
  const filas = await query<Fila<RegistroRow>>(
    `SELECT r.*, s.nombre_sector, s.nombre_corto, o.numero_ot, o.cliente
       FROM registros_tiempos r
       JOIN sectores s ON s.id = r.sector_id
       JOIN ordenes_trabajo o ON o.id = r.ot_id
      WHERE r.id = $1;`,
    [id],
  );

  const fila = filas.rows[0];
  return fila ? mapRegistro(fila) : null;
}

async function registroSimple(id: number): Promise<RegistroTiempo | null> {
  const filas = await query<Fila<RegistroRow>>(
    "SELECT * FROM registros_tiempos WHERE id = $1;",
    [id],
  );

  const fila = filas.rows[0];
  return fila ? mapRegistro(fila) : null;
}

/*
 * R1: same order + same sector already open.
 * R2: a non-shared sector cannot host two orders at once.
 * R3: an operator cannot have two open stages.
 *
 * Accepts an optional transaction client so the same checks can be replayed
 * with the advisory locks held (closing the TOCTOU hole).
 */
async function verificarConflictos(
  otId: number,
  sectorId: number,
  sector: Sector,
  numeroOT: string,
  operario: string,
  client?: PoolClient,
): Promise<void> {
  const ejecutar = ejecutorDe(client);

  const misma = await ejecutar<Fila<RegistroRow>>(
    `SELECT r.*, s.nombre_sector
       FROM registros_tiempos r
       JOIN sectores s ON s.id = r.sector_id
      WHERE r.ot_id = $1 AND r.sector_id = $2 AND r.estado_etapa IN ${ABIERTOS_SQL}
      ORDER BY r.fecha_hora_inicio DESC
      LIMIT 1;`,
    [otId, sectorId],
  );

  const abiertaMisma = misma.rows[0];
  if (abiertaMisma) {
    throw new ApiError(
      409,
      `Ya hay una etapa ${String(abiertaMisma.estado_etapa).toLowerCase()} de ${numeroOT} ` +
        `en ${sector.nombre_sector} (operario ${abiertaMisma.operario_nombre}).`,
      {
        etapa: mapRegistro(abiertaMisma),
        accion:
          abiertaMisma.estado_etapa === "Pausado"
            ? "Reanude la etapa pausada o finalícela antes de iniciar otra."
            : "Finalice la etapa en curso antes de iniciar otra.",
      },
    );
  }

  if (!sector.es_compartido) {
    const ocupada = await ejecutar<Fila<RegistroRow>>(
      `SELECT r.*, o.numero_ot, s.nombre_sector
         FROM registros_tiempos r
         JOIN ordenes_trabajo o ON o.id = r.ot_id
         JOIN sectores s ON s.id = r.sector_id
        WHERE r.sector_id = $1 AND r.ot_id <> $2 AND r.estado_etapa IN ${ABIERTOS_SQL}
        ORDER BY r.fecha_hora_inicio DESC
        LIMIT 1;`,
      [sectorId, otId],
    );

    const enSector = ocupada.rows[0];
    if (enSector) {
      throw new ApiError(
        409,
        `El sector ${sector.nombre_sector} NO es compartido y ya está trabajando la ` +
          `${enSector.numero_ot} (operario ${enSector.operario_nombre}).`,
        {
          etapa: mapRegistro(enSector),
          accion: "Espere a que finalice esa etapa o marque el sector como compartido.",
        },
      );
    }
  }

  const delOperario = await ejecutar<Fila<RegistroRow>>(
    `SELECT r.*, o.numero_ot, s.nombre_sector
       FROM registros_tiempos r
       JOIN ordenes_trabajo o ON o.id = r.ot_id
       JOIN sectores s ON s.id = r.sector_id
      WHERE lower(r.operario_nombre) = lower($1) AND r.estado_etapa IN ${ABIERTOS_SQL}
      ORDER BY r.fecha_hora_inicio DESC
      LIMIT 1;`,
    [operario],
  );

  const abiertaOperario = delOperario.rows[0];
  if (abiertaOperario) {
    throw new ApiError(
      409,
      `El operario ${operario} ya tiene una etapa abierta: ` +
        `${abiertaOperario.numero_ot} / ${abiertaOperario.nombre_sector}.`,
      {
        etapa: mapRegistro(abiertaOperario),
        accion:
          "Si es esa misma etapa, utilice REANUDAR o FINALIZAR; si no, finalícela antes de iniciar otra.",
      },
    );
  }
}

export interface AccionIniciar {
  otId: number;
  sectorId: number;
  operario: string;
}

/**
 * Opens a stage (rules R1-R8 + O2/O3).
 *
 * Everything is re-checked INSIDE the transaction, with the advisory locks and
 * the order row locked `FOR UPDATE`: the pre-transaction reads are a snapshot
 * that another session can invalidate a millisecond later.
 */
export async function iniciarEtapa({
  otId,
  sectorId,
  operario,
}: AccionIniciar): Promise<RegistroTiempo> {
  const otFila = await query<Fila<OrdenRow>>("SELECT * FROM ordenes_trabajo WHERE id = $1;", [otId]);
  if (!otFila.rows[0]) throw new ApiError(404, `No existe la OT con id ${otId}.`);
  const ot = mapOT(otFila.rows[0]);

  const sectorFila = await query<Fila<SectorRow>>("SELECT * FROM sectores WHERE id = $1;", [sectorId]);
  if (!sectorFila.rows[0]) throw new ApiError(404, `No existe el sector con id ${sectorId}.`);
  const sector = mapSector(sectorFila.rows[0]);

  // R7: a deactivated sector takes no new stages.
  if (!sector.activo) {
    throw new ApiError(409, `El sector "${sector.nombre_sector}" está DESACTIVADO.`, {
      accion: "Reactívelo desde Administración → Sectores y Flujos si debe usarse.",
    });
  }

  // R8: the sector must belong to the order's line (or be shared).
  const lineaOT = ot.linea_area || "Placares";
  if (!sectorAplica(sector, lineaOT)) {
    throw new ApiError(
      409,
      `"${sector.nombre_sector}" pertenece a la línea ${sector.linea_area} y la ${ot.numero_ot} es de ${lineaOT}.`,
      { accion: "Fiché en un sector de la línea de esta OT o edite la OT en Administración." },
    );
  }

  // O3, checked early so the message is clear before the flow rules.
  const maestro = await query<Fila<{ id: number; activo: number }>>(
    "SELECT id, activo FROM operarios WHERE nombre_norm = $1;",
    [claveNormalizada(operario)],
  );
  if (maestro.rows[0] && !maestro.rows[0].activo) {
    throw new ApiError(
      409,
      `El operario "${operario}" está DESACTIVADO en el maestro y no puede iniciar etapas.`,
      { accion: "Reactívelo desde Administración → Operarios o utilice otro operario." },
    );
  }

  // R5 early exit: do not take locks for an order that is already closed.
  if (ot.estado_general === "Finalizado") {
    throw new ApiError(
      409,
      `La ${ot.numero_ot} está FINALIZADA: no se pueden iniciar nuevas etapas.`,
      { accion: "Cambie el estado de la OT en Administración si es un error." },
    );
  }

  // R4: a specialty can only start if the order asked for it.
  if (sector.clave_especial && !requiereEspecial(ot, sector.clave_especial)) {
    throw new ApiError(
      409,
      `La ${ot.numero_ot} no está marcada como requiere "${sector.nombre_sector}".`,
      { accion: "Edite la OT en Administración y marque la casilla correspondiente si es necesario." },
    );
  }

  // R6: flow precedence.
  const sectores = await cargarSectores();
  const finalizados = await sectoresFinalizados(otId);
  const faltantes = prerrequisitosSector(ot, sectorId, sectores, finalizados);

  if (faltantes.length) {
    throw new ApiError(
      409,
      `Flujo incompleto: antes de iniciar ${sector.nombre_sector} en la ${ot.numero_ot} ` +
        `debe finalizar: ${faltantes.map((f) => f.nombre_sector).join(", ")}.`,
      {
        sectores_faltantes: faltantes.map((f) => ({ id: f.id, nombre_sector: f.nombre_sector })),
        accion: "Finalice los sectores indicados en el orden del flujo antes de iniciar este.",
      },
    );
  }

  await verificarConflictos(otId, sectorId, sector, ot.numero_ot, operario);

  // O2: transparent auto-registration of an unknown operator.
  const canonico = await asegurarOperario(operario);

  const ahora = ahoraUTC();
  let registroId: number;

  try {
    registroId = await withTransaction(
      async (client) => {
        // R5 under lock: the `ot` read above is a pre-transaction snapshot and
        // another session may have closed the order since.
        const vigente = await client.query<
          Fila<{ id: number; numero_ot: string; estado_general: string }>
        >(
          "SELECT id, numero_ot, estado_general FROM ordenes_trabajo WHERE id = $1 FOR UPDATE;",
          [otId],
        );
        const otAhora = vigente.rows[0];

        if (!otAhora) {
          throw new ApiError(409, "La OT fue eliminada mientras se abría la etapa.", {
            accion: "Actualice la lista de OTs e intente de nuevo.",
          });
        }

        if (otAhora.estado_general === "Finalizado") {
          throw new ApiError(
            409,
            `La ${otAhora.numero_ot} está FINALIZADA: no se pueden iniciar nuevas etapas.`,
            { accion: "Cambie el estado de la OT en Administración si es un error." },
          );
        }

        await verificarConflictos(
          otId,
          sectorId,
          sector,
          otAhora.numero_ot,
          canonico.nombre,
          client,
        );

        const alta = await client.query<Fila<{ id: number }>>(
          `INSERT INTO registros_tiempos
             (ot_id, sector_id, operario_nombre, fecha_hora_inicio, estado_etapa,
              pausa_inicio, segundos_pausados, fecha_creacion, fecha_actualizacion)
           VALUES ($1, $2, $3, $4, 'En Proceso', NULL, 0, $4, $4)
           RETURNING id;`,
          [otId, sectorId, canonico.nombre, ahora],
        );

        if (otAhora.estado_general === "En Cola" || otAhora.estado_general === "Detenido") {
          await client.query(
            `UPDATE ordenes_trabajo
                SET estado_general = 'En Producción', fecha_actualizacion = $1
              WHERE id = $2 AND estado_general IN ('En Cola','Detenido');`,
            [ahora, otId],
          );
        }

        return Number(alta.rows[0].id);
      },
      [
        [LOCK_OT, otId],
        [LOCK_SECTOR, sectorId],
        [LOCK_OPERATOR, lockKey(claveNormalizada(canonico.nombre))],
      ],
    );
  } catch (error) {
    // 23505 = the partial unique index caught a duplicate open stage.
    if (esViolacionUnica(error)) {
      throw new ApiError(
        409,
        `La ${ot.numero_ot} ya no puede iniciar en ${sector.nombre_sector}: ` +
          "otra etapa abierta entró al mismo tiempo.",
        { accion: "Actualice el estado en vivo e intente de nuevo." },
      );
    }
    throw error;
  }

  const creado = await registroConJoin(registroId);
  if (!creado) throw new ApiError(500, "La etapa se creó pero no se pudo leer de vuelta.");

  return creado;
}

export interface AccionPausa {
  registroId: number;
  motivo: MotivoPausa;
  observacion: string | null;
}

export async function pausarEtapa({
  registroId,
  motivo,
  observacion,
}: AccionPausa): Promise<RegistroTiempo> {
  const filas = await query<Fila<RegistroRow>>(
    "SELECT * FROM registros_tiempos WHERE id = $1;",
    [registroId],
  );
  const fila = filas.rows[0];

  if (!fila) throw new ApiError(404, `No existe el registro de tiempo con id ${registroId}.`);
  if (fila.estado_etapa === "Finalizado") {
    throw new ApiError(409, "La etapa ya fue finalizada: no se puede pausar.");
  }
  if (fila.estado_etapa === "Pausado") throw new ApiError(409, "La etapa ya está pausada.");

  const ahora = ahoraUTC();

  await withTransaction(
    async (client) => {
      const fresco = await client.query<Fila<{ estado_etapa: EstadoEtapa }>>(
        "SELECT estado_etapa FROM registros_tiempos WHERE id = $1 FOR UPDATE;",
        [registroId],
      );
      const actual = fresco.rows[0];

      if (!actual) {
        throw new ApiError(404, `No existe el registro de tiempo con id ${registroId}.`);
      }
      if (actual.estado_etapa === "Finalizado") {
        throw new ApiError(409, "La etapa ya fue finalizada: no se puede pausar.", {
          estado_actual: actual.estado_etapa,
        });
      }
      if (actual.estado_etapa === "Pausado") {
        throw new ApiError(409, "La etapa ya está pausada.", {
          estado_actual: actual.estado_etapa,
        });
      }

      const actualizado = await client.query(
        `UPDATE registros_tiempos
            SET estado_etapa = 'Pausado', motivo_pausa = $1, pausa_inicio = $2,
                observacion = COALESCE($3, observacion), fecha_actualizacion = $2
          WHERE id = $4 AND estado_etapa = 'En Proceso';`,
        [motivo, ahora, observacion, registroId],
      );

      if ((actualizado.rowCount ?? 0) === 0) {
        const vigente = await client.query<Fila<{ estado_etapa: EstadoEtapa }>>(
          "SELECT estado_etapa FROM registros_tiempos WHERE id = $1;",
          [registroId],
        );
        const estado = vigente.rows[0]?.estado_etapa ?? null;

        throw new ApiError(
          409,
          estado === "Pausado"
            ? "La etapa ya estaba pausada (acción repetida o en paralelo)."
            : "La etapa ya fue finalizada: no se puede pausar.",
          { estado_actual: estado },
        );
      }

      // Pause event: feeds the lost-hours metrics.
      await client.query(
        `INSERT INTO eventos_pausa (registro_id, motivo_pausa, observacion, inicio_pausa, fecha_creacion)
         VALUES ($1, $2, $3, $4, $4);`,
        [registroId, motivo, observacion, ahora],
      );
    },
    [
      [LOCK_OT, Number(fila.ot_id)],
      [LOCK_SECTOR, Number(fila.sector_id)],
    ],
  );

  const registro = await registroSimple(registroId);
  if (!registro) throw new ApiError(404, `No existe el registro de tiempo con id ${registroId}.`);

  return registro;
}

export interface AccionReanudar {
  registroId: number;
  observacion: string | null;
}

export async function reanudarEtapa({
  registroId,
  observacion,
}: AccionReanudar): Promise<RegistroTiempo> {
  const filas = await query<Fila<RegistroRow>>(
    "SELECT * FROM registros_tiempos WHERE id = $1;",
    [registroId],
  );
  const fila = filas.rows[0];

  if (!fila) throw new ApiError(404, `No existe el registro de tiempo con id ${registroId}.`);
  if (fila.estado_etapa === "Finalizado") {
    throw new ApiError(409, "La etapa ya fue finalizada: no se puede reanudar.");
  }
  if (fila.estado_etapa !== "Pausado") throw new ApiError(409, "La etapa no está pausada.");

  await withTransaction(
    async (client) => {
      const fresco = await client.query<Fila<RegistroRow>>(
        "SELECT * FROM registros_tiempos WHERE id = $1 FOR UPDATE;",
        [registroId],
      );
      const actual = fresco.rows[0];

      if (!actual) {
        throw new ApiError(404, `No existe el registro de tiempo con id ${registroId}.`);
      }
      if (actual.estado_etapa === "Finalizado") {
        throw new ApiError(409, "La etapa ya fue finalizada: no se puede reanudar.");
      }
      if (actual.estado_etapa !== "Pausado") throw new ApiError(409, "La etapa no está pausada.");
      if (!actual.pausa_inicio) {
        throw new ApiError(409, "La etapa no tiene una pausa registrada para reanudar.");
      }

      const ahora = ahoraUTC();
      const previos = Number(actual.segundos_pausados || 0);
      const transcurridos = Math.max(
        0,
        (new Date(ahora).getTime() - new Date(actual.pausa_inicio).getTime()) / 1000,
      );

      const actualizado = await client.query(
        `UPDATE registros_tiempos
            SET estado_etapa = 'En Proceso', pausa_inicio = NULL, segundos_pausados = $1,
                observacion = COALESCE($2, observacion), fecha_actualizacion = $3
          WHERE id = $4 AND estado_etapa = 'Pausado';`,
        [previos + transcurridos, observacion, ahora, registroId],
      );

      if ((actualizado.rowCount ?? 0) === 0) {
        throw new ApiError(409, "La etapa ya no está pausada (acción repetida o en paralelo).");
      }

      await client.query(
        `UPDATE eventos_pausa
            SET fin_pausa = $1, segundos = $2, observacion = COALESCE(observacion, $3)
          WHERE registro_id = $4 AND fin_pausa IS NULL;`,
        [ahora, Math.round(transcurridos * 100) / 100, observacion, registroId],
      );
    },
    [
      [LOCK_OT, Number(fila.ot_id)],
      [LOCK_SECTOR, Number(fila.sector_id)],
    ],
  );

  const registro = await registroSimple(registroId);
  if (!registro) throw new ApiError(404, `No existe el registro de tiempo con id ${registroId}.`);

  return registro;
}

export interface ResultadoFinalizar {
  registro: RegistroTiempo;
  ot: OrdenTrabajo | null;
  ot_auto_cerrada: boolean;
}

export async function finalizarEtapa(
  registroId: number,
  observacion: string | null,
): Promise<ResultadoFinalizar> {
  const filas = await query<Fila<RegistroRow>>(
    "SELECT * FROM registros_tiempos WHERE id = $1;",
    [registroId],
  );
  const fila = filas.rows[0];

  if (!fila) throw new ApiError(404, `No existe el registro de tiempo con id ${registroId}.`);
  if (fila.estado_etapa === "Finalizado") {
    throw new ApiError(409, "La etapa ya fue finalizada.", { etapa: mapRegistro(fila) });
  }

  let otAutoCerrada = false;

  await withTransaction(
    async (client) => {
      const fresco = await client.query<Fila<RegistroRow>>(
        "SELECT * FROM registros_tiempos WHERE id = $1 FOR UPDATE;",
        [registroId],
      );
      const actual = fresco.rows[0];

      if (!actual) {
        throw new ApiError(404, `No existe el registro de tiempo con id ${registroId}.`);
      }
      if (actual.estado_etapa === "Finalizado") {
        throw new ApiError(409, "La etapa ya fue finalizada.", { etapa: mapRegistro(actual) });
      }

      const ahora = ahoraUTC();
      let pausados = Number(actual.segundos_pausados || 0);
      let ultimaPausa = 0;

      if (actual.pausa_inicio) {
        ultimaPausa = Math.max(
          0,
          (new Date(ahora).getTime() - new Date(actual.pausa_inicio).getTime()) / 1000,
        );
        pausados += ultimaPausa;
      }

      const duracion = calcularDuracionMinutos(actual.fecha_hora_inicio, ahora, pausados, null);

      const actualizado = await client.query(
        `UPDATE registros_tiempos
            SET estado_etapa = 'Finalizado', fecha_hora_fin = $1, duracion_minutos = $2,
                pausa_inicio = NULL, segundos_pausados = $3,
                observacion = COALESCE($4, observacion), fecha_actualizacion = $1
          WHERE id = $5 AND estado_etapa IN ('En Proceso','Pausado');`,
        [ahora, duracion, pausados, observacion, registroId],
      );

      if ((actualizado.rowCount ?? 0) === 0) {
        throw new ApiError(409, "La etapa cambió de estado; recargue e intente de nuevo.");
      }

      if (actual.pausa_inicio) {
        await client.query(
          `UPDATE eventos_pausa
              SET fin_pausa = $1, segundos = $2
            WHERE registro_id = $3 AND fin_pausa IS NULL;`,
          [ahora, Math.round(ultimaPausa * 100) / 100, registroId],
        );
      }

      // AUTO-CLOSE: evaluated on EVERY close, not only on the last sector of
      // the line. If nothing is open and everything the order requires is
      // finished, the order itself is done.
      const abiertas = await client.query<Fila<{ n: number }>>(
        `SELECT COUNT(*)::int AS n
           FROM registros_tiempos
          WHERE ot_id = $1 AND estado_etapa IN ${ABIERTOS_SQL};`,
        [actual.ot_id],
      );

      if (Number(abiertas.rows[0]?.n ?? 0) > 0) return;

      const otFila = await client.query<Fila<OrdenRow>>(
        "SELECT * FROM ordenes_trabajo WHERE id = $1;",
        [actual.ot_id],
      );
      const otActual = otFila.rows[0];
      if (!otActual || otActual.estado_general === "Finalizado") return;

      const ejecutar = ejecutorDe(client);
      const ot = mapOT(otActual);
      const sectores = await cargarSectores(ejecutar);
      const requeridos = sectoresRequeridos(ot, sectores).map((s) => s.id);
      const finalizados = await sectoresFinalizados(Number(actual.ot_id), ejecutar);
      const todoListo = requeridos.length > 0 && requeridos.every((id) => finalizados.has(id));

      if (!todoListo) return;

      const cierre = await client.query(
        `UPDATE ordenes_trabajo
            SET estado_general = 'Finalizado', fecha_actualizacion = $1
          WHERE id = $2 AND estado_general <> 'Finalizado';`,
        [ahora, actual.ot_id],
      );
      otAutoCerrada = (cierre.rowCount ?? 0) > 0;
    },
    [
      [LOCK_OT, Number(fila.ot_id)],
      [LOCK_SECTOR, Number(fila.sector_id)],
    ],
  );

  const registro = await registroConJoin(registroId);
  if (!registro) throw new ApiError(404, `No existe el registro de tiempo con id ${registroId}.`);

  const otFila = await query<Fila<OrdenRow>>("SELECT * FROM ordenes_trabajo WHERE id = $1;", [
    registro.ot_id,
  ]);

  return {
    registro,
    ot: otFila.rows[0] ? mapOT(otFila.rows[0]) : null,
    ot_auto_cerrada: otAutoCerrada,
  };
}
