import type { QueryResultRow } from "pg";
import {
  ESTADOS_QMS,
  TIPOS_FALLA_QMS,
  mapNoConformidad,
  motivoPausaDe,
  type EstadoQMS,
  type NoConformidad,
  type NoConformidadRow,
  type ResumenCalidad,
} from "@/lib/calidad";
import { LOCK_OT, LOCK_SECTOR, query, withTransaction } from "@/lib/db";
import { correrDias, periodoActual, inicioDiaLocalUTC, ventanaLocalUTC } from "@/lib/fechas-planta";
import {
  ApiError,
  booleano,
  entero,
  enumOpcion,
  textoOpcional,
  textoRequerido,
} from "@/lib/http";
import { ahoraUTC, ESTADOS_ABIERTOS } from "@/lib/produccion";

/*
 * QMS data layer: non-conformities, their monthly summary and the pause they
 * cause on the floor.
 *
 * The rules live here (not in the route handlers) because there are two entry
 * points: the API and the Server Action used by the admin panel. Validation in
 * one place means the terminal, the API client and the panel cannot diverge.
 *
 * Everything that touches the plant state is transactional: pausing a stage,
 * writing its pause event and stopping the order must all happen or none.
 */

type Fila<T> = T & QueryResultRow;

/** Q3: ~2.6 MB of binary once the base64 is decoded. */
const MAX_FOTO = 3_500_000;
const MAX_LISTA = 500;
const MAX_OBSERVACION = 2_000;

const SQL_NC = `
  SELECT nc.*,
         o.numero_ot, o.cliente, o.linea_area,
         s.nombre_sector
    FROM no_conformidades nc
    JOIN ordenes_trabajo o ON o.id = nc.ot_id
    JOIN sectores s         ON s.id = nc.sector_id`;

/* -------------------------------------------------------------------------- */
/* Input normalisation                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Q3: accepts a data URI or an http(s) URL. A bare base64 is assumed JPEG so a
 * browser that sends only the payload does not lose the evidence.
 */
function normalizarFoto(entrada: Record<string, unknown>): string | null {
  const base64 = entrada.foto_base64;
  const remota = entrada.foto_url;

  if (base64 !== undefined && base64 !== null && String(base64).trim() !== "") {
    let foto = String(base64).trim();
    if (!/^data:/i.test(foto)) foto = `data:image/jpeg;base64,${foto}`;
    foto = foto.replace(/\s+/g, "");

    if (!/^data:image\/(webp|jpe?g|png);base64,[A-Za-z0-9+/=]+$/i.test(foto)) {
      throw new ApiError(400, "La foto debe ser una imagen WEBP, JPEG o PNG codificada en base64.", {
        formatos: ["image/webp", "image/jpeg", "image/png"],
      });
    }
    if (foto.length > MAX_FOTO) {
      throw new ApiError(413, "La foto de evidencia es demasiado grande. Vuelva a tomarla con menor resolución.", {
        max_caracteres: MAX_FOTO,
      });
    }
    return foto;
  }

  if (remota !== undefined && remota !== null && String(remota).trim() !== "") {
    const url = String(remota).trim();
    if (url.length > 4_000) throw new ApiError(400, "La URL de la foto es demasiado larga.");

    let parseada: URL | null = null;
    try {
      parseada = new URL(url);
    } catch {
      parseada = null;
    }
    if (!parseada || !/^https?:$/.test(parseada.protocol)) {
      throw new ApiError(400, "La URL de la foto debe comenzar con http:// o https://.");
    }
    return url;
  }

  return null;
}

/** `[inicio, fin)` of a plant month (`YYYY-MM`), plus its readable bounds. */
function rangoPeriodo(periodo?: string) {
  const p = periodo && periodo.trim() ? periodo.trim() : periodoActual();
  if (!/^\d{4}-\d{2}$/.test(p)) throw new ApiError(400, "El período debe tener formato AAAA-MM.");

  const anio = Number(p.slice(0, 4));
  const mes = Number(p.slice(5, 7));
  if (mes < 1 || mes > 12) throw new ApiError(400, "El mes del período no es válido.");

  const primerDia = `${p}-01`;
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
  const [desdeUTC, hastaUTC] = ventanaLocalUTC(primerDia, ultimoDia);

  return { periodo: p, primerDia, ultimoDia, desdeUTC, hastaUTC };
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Executive summary of the month: volume by state, Pareto by failure type and
 * the quality FTT (advanced orders without an open non-conformity).
 *
 * The window is built in plant time (UTC-3) and compared as instants, so a
 * failure registered at 23:30 on the last day still counts for that month.
 */
export async function resumenCalidad(periodo?: string): Promise<ResumenCalidad> {
  const rango = rangoPeriodo(periodo);

  const [totales, abiertasTotales, porTipo, fttRow] = await Promise.all([
    query<Fila<{
      total: number;
      pendientes: number;
      en_reproceso: number;
      resueltas: number;
      descartadas: number;
      abiertas: number;
    }>>(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE estado = 'Pendiente')    AS pendientes,
              COUNT(*) FILTER (WHERE estado = 'En Reproceso') AS en_reproceso,
              COUNT(*) FILTER (WHERE estado = 'Resuelto')     AS resueltas,
              COUNT(*) FILTER (WHERE estado = 'Descartado')   AS descartadas,
              COUNT(*) FILTER (WHERE estado IN ('Pendiente','En Reproceso')) AS abiertas
         FROM no_conformidades
        WHERE fecha_registro >= $1::timestamptz AND fecha_registro < $2::timestamptz;`,
      [rango.desdeUTC, rango.hastaUTC],
    ),
    query<Fila<{ abiertas: number }>>(
      `SELECT COUNT(*) AS abiertas
         FROM no_conformidades
        WHERE estado IN ('Pendiente','En Reproceso');`,
    ),
    query<Fila<{ tipo_falla: string; cantidad: number }>>(
      `SELECT tipo_falla, COUNT(*) AS cantidad
         FROM no_conformidades
        WHERE fecha_registro >= $1::timestamptz AND fecha_registro < $2::timestamptz
          AND estado <> 'Descartado'
        GROUP BY tipo_falla
        ORDER BY cantidad DESC, tipo_falla ASC;`,
      [rango.desdeUTC, rango.hastaUTC],
    ),
    query<Fila<{ evaluadas: number; conformes: number }>>(
      `WITH avanzadas AS (
         SELECT DISTINCT r.ot_id
           FROM registros_tiempos r
          WHERE r.estado_etapa = 'Finalizado'
            AND r.fecha_hora_inicio::timestamptz >= $1::timestamptz
            AND r.fecha_hora_inicio::timestamptz < $2::timestamptz
       ),
       con_nc AS (
         SELECT DISTINCT ot_id
           FROM no_conformidades
          WHERE fecha_registro >= $1::timestamptz
            AND fecha_registro < $2::timestamptz
            AND estado <> 'Descartado'
       )
       SELECT COUNT(*) AS evaluadas,
              COALESCE(SUM(CASE WHEN NOT EXISTS (
                SELECT 1 FROM con_nc c WHERE c.ot_id = avanzadas.ot_id
              ) THEN 1 ELSE 0 END), 0) AS conformes
         FROM avanzadas;`,
      [rango.desdeUTC, rango.hastaUTC],
    ),
  ]);

  const fila = totales.rows[0];
  const evaluadas = Number(fttRow.rows[0]?.evaluadas ?? 0);
  const conformes = Number(fttRow.rows[0]?.conformes ?? 0);
  const tipos = porTipo.rows.map((t) => ({
    tipo_falla: t.tipo_falla,
    cantidad: Number(t.cantidad ?? 0),
  }));

  return {
    periodo: rango.periodo,
    desde: rango.primerDia,
    hasta: rango.ultimoDia,
    total_mes: Number(fila?.total ?? 0),
    pendientes: Number(fila?.pendientes ?? 0),
    en_reproceso: Number(fila?.en_reproceso ?? 0),
    resueltas_mes: Number(fila?.resueltas ?? 0),
    descartadas_mes: Number(fila?.descartadas ?? 0),
    abiertas: Number(fila?.abiertas ?? 0),
    abiertas_totales: Number(abiertasTotales.rows[0]?.abiertas ?? 0),
    por_tipo: tipos,
    tipo_mas_recurrente: tipos[0] ?? null,
    ftt: {
      evaluadas,
      conformes,
      porcentaje: evaluadas > 0 ? Math.round((conformes / evaluadas) * 1000) / 10 : null,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* List                                                                        */
/* -------------------------------------------------------------------------- */

export interface EntradaFiltrosCalidad {
  ot_id?: string | number;
  sector_id?: string | number;
  estado?: string;
  tipo_falla?: string;
  desde?: string;
  hasta?: string;
  periodo?: string;
  limite?: string | number;
}

export interface ListadoCalidad {
  no_conformidades: NoConformidad[];
  resumen: ResumenCalidad;
  filtros: {
    ot_id: number | null;
    sector_id: number | null;
    estado: string | null;
    tipo_falla: string | null;
    desde: string | null;
    hasta: string | null;
    limite: number;
  };
}

export async function listarNoConformidades(
  entrada: EntradaFiltrosCalidad = {},
): Promise<ListadoCalidad> {
  const where: string[] = [];
  const params: unknown[] = [];

  const otId = entrada.ot_id === undefined || entrada.ot_id === ""
    ? null
    : entero(entrada.ot_id, "ot_id");
  if (otId !== null) {
    params.push(otId);
    where.push(`nc.ot_id = $${params.length}`);
  }

  const sectorId = entrada.sector_id === undefined || entrada.sector_id === ""
    ? null
    : entero(entrada.sector_id, "sector_id");
  if (sectorId !== null) {
    params.push(sectorId);
    where.push(`nc.sector_id = $${params.length}`);
  }

  const estado = entrada.estado === undefined || entrada.estado === ""
    ? null
    : enumOpcion(entrada.estado, ESTADOS_QMS, "estado");
  if (estado !== null) {
    params.push(estado);
    where.push(`nc.estado = $${params.length}`);
  }

  const tipo = entrada.tipo_falla === undefined || entrada.tipo_falla === ""
    ? null
    : enumOpcion(entrada.tipo_falla, TIPOS_FALLA_QMS, "tipo_falla");
  if (tipo !== null) {
    params.push(tipo);
    where.push(`nc.tipo_falla = $${params.length}`);
  }

  const desde = entrada.desde?.trim() || null;
  if (desde) {
    params.push(inicioDiaLocalUTC(desde.slice(0, 10)));
    where.push(`nc.fecha_registro >= $${params.length}`);
  }

  const hasta = entrada.hasta?.trim() || null;
  if (hasta) {
    params.push(inicioDiaLocalUTC(correrDias(hasta.slice(0, 10), 1)));
    where.push(`nc.fecha_registro < $${params.length}`);
  }

  const pedido = Number(entrada.limite);
  const limite =
    entrada.limite === undefined || entrada.limite === ""
      ? 200
      : Math.min(MAX_LISTA, Math.max(1, Number.isFinite(pedido) ? Math.floor(pedido) : 200));

  params.push(limite);

  const [filas, resumen] = await Promise.all([
    query<Fila<NoConformidadRow>>(
      `${SQL_NC}
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY nc.fecha_registro DESC, nc.id DESC
       LIMIT $${params.length};`,
      params,
    ),
    resumenCalidad(entrada.periodo),
  ]);

  return {
    no_conformidades: filas.rows.map(mapNoConformidad),
    resumen,
    filtros: {
      ot_id: otId,
      sector_id: sectorId,
      estado,
      tipo_falla: tipo,
      desde,
      hasta,
      limite,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Create (rule Q4)                                                            */
/* -------------------------------------------------------------------------- */

export interface ResultadoAltaCalidad {
  no_conformidad: NoConformidad;
  etapa: {
    id: number;
    pausada: boolean;
    motivo_pausa?: string;
    ya_estaba_pausada?: boolean;
  } | null;
  ot: { id: number; numero_ot: string; estado_general: string };
  resumen: ResumenCalidad;
}

/**
 * Registers a non-conformity.
 *
 * Rule Q4 is the delicate part: if the order has a stage "En Proceso" in that
 * sector, it gets paused, a `eventos_pausa` row is written (that is what feeds
 * lost-time metrics) and the order becomes "Detenido". All three writes plus
 * the non-conformity itself happen in ONE transaction under `LOCK_OT` and
 * `LOCK_SECTOR`, so a concurrent finish of the stage cannot leave a paused row
 * without its event.
 *
 * `pausar_etapa:false` allows loading a historical failure without touching
 * the current state of the plant.
 */
export async function crearNoConformidad(
  entrada: Record<string, unknown>,
  reportante: string | null,
): Promise<ResultadoAltaCalidad> {
  const otId = entero(entrada.ot_id, "ot_id");
  const sectorId = entero(entrada.sector_id, "sector_id");
  const tipoFalla = enumOpcion(entrada.tipo_falla, TIPOS_FALLA_QMS, "tipo_falla");
  const observacion = textoOpcional(entrada.observacion, "Observación", { max: MAX_OBSERVACION });
  const operario = textoOpcional(entrada.operario_responsable, "Operario responsable", { max: 120 });
  const reporta = textoOpcional(entrada.encargado_reporta, "Encargado que reporta", { max: 120 });
  const encargado = reporta ?? reportante;

  if (!encargado) throw new ApiError(400, 'El campo "encargado_reporta" es obligatorio.');

  const foto = normalizarFoto(entrada);
  const pausarEtapa = booleano(entrada.pausar_etapa, true);
  const estadoInicial: EstadoQMS =
    entrada.estado === undefined || entrada.estado === null || entrada.estado === ""
      ? "Pendiente"
      : enumOpcion(entrada.estado, ["Pendiente", "En Reproceso"], "estado");

  const ahora = ahoraUTC();

  const resultado = await withTransaction(
    async (client) => {
      const ot = await client.query<Fila<{ id: number; numero_ot: string; estado_general: string }>>(
        "SELECT id, numero_ot, estado_general FROM ordenes_trabajo WHERE id = $1 FOR UPDATE;",
        [otId],
      );
      const orden = ot.rows[0];
      if (!orden) throw new ApiError(404, `No existe la OT con id ${otId}.`);

      const sector = await client.query<Fila<{ id: number; nombre_sector: string }>>(
        "SELECT id, nombre_sector FROM sectores WHERE id = $1;",
        [sectorId],
      );
      if (!sector.rows[0]) throw new ApiError(404, `No existe el sector con id ${sectorId}.`);

      const abierta = await client.query<Fila<{ id: number; estado_etapa: string }>>(
        `SELECT id, estado_etapa
           FROM registros_tiempos
          WHERE ot_id = $1 AND sector_id = $2
            AND estado_etapa IN ${ABIERTOS_SQL()}
          ORDER BY id DESC
          LIMIT 1
          FOR UPDATE;`,
        [otId, sectorId],
      );

      let etapa: ResultadoAltaCalidad["etapa"] = null;
      const fila = abierta.rows[0];

      if (fila) {
        if (fila.estado_etapa === "En Proceso" && pausarEtapa) {
          const motivo = motivoPausaDe(tipoFalla);
          const obsPausa = `No conformidad QMS: ${tipoFalla}` +
            (observacion ? ` · ${observacion}` : "");

          const actualizada = await client.query(
            `UPDATE registros_tiempos
                SET estado_etapa = 'Pausado', motivo_pausa = $1, pausa_inicio = $2,
                    observacion = COALESCE($3, observacion), fecha_actualizacion = $2
              WHERE id = $4 AND estado_etapa = 'En Proceso';`,
            [motivo, ahora, obsPausa.slice(0, 500), fila.id],
          );

          if (actualizada.rowCount) {
            await client.query(
              `INSERT INTO eventos_pausa
                 (registro_id, motivo_pausa, observacion, inicio_pausa, fecha_creacion)
               VALUES ($1, $2, $3, $4, $4);`,
              [fila.id, motivo, obsPausa.slice(0, 500), ahora],
            );
            etapa = { id: Number(fila.id), pausada: true, motivo_pausa: motivo };
          }
        }

        if (!etapa) {
          etapa = {
            id: Number(fila.id),
            pausada: false,
            ya_estaba_pausada: fila.estado_etapa === "Pausado",
          };
        }
      }

      // An open failure stops the order: it cannot keep advancing as if nothing
      // happened. Finished orders keep their state (the failure is a later
      // quality record). A historical load must not touch the plant.
      let estadoOT = orden.estado_general;
      if (
        pausarEtapa &&
        orden.estado_general !== "Finalizado" &&
        (orden.estado_general === "En Producción" || etapa)
      ) {
        await client.query(
          `UPDATE ordenes_trabajo
              SET estado_general = 'Detenido', fecha_actualizacion = $1
            WHERE id = $2;`,
          [ahora, otId],
        );
        estadoOT = "Detenido";
      }

      const insertada = await client.query<Fila<{ id: number }>>(
        `INSERT INTO no_conformidades
           (ot_id, sector_id, operario_responsable, encargado_reporta, tipo_falla,
            observacion, foto_url, estado, fecha_registro, fecha_actualizacion)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
         RETURNING id;`,
        [otId, sectorId, operario, encargado, tipoFalla, observacion, foto, estadoInicial, ahora],
      );

      return {
        id: Number(insertada.rows[0].id),
        etapa,
        ot: { id: Number(orden.id), numero_ot: orden.numero_ot, estado_general: estadoOT },
      };
    },
    [
      [LOCK_OT, otId],
      [LOCK_SECTOR, sectorId],
    ],
  );

  const creada = await query<Fila<NoConformidadRow>>(`${SQL_NC} WHERE nc.id = $1;`, [resultado.id]);

  return {
    no_conformidad: mapNoConformidad(creada.rows[0]),
    etapa: resultado.etapa,
    ot: resultado.ot,
    resumen: await resumenCalidad(),
  };
}

/* -------------------------------------------------------------------------- */
/* Resolve (rule Q5)                                                           */
/* -------------------------------------------------------------------------- */

export interface ResultadoResolucion {
  no_conformidad: NoConformidad;
  resumen: ResumenCalidad;
}

/**
 * Closes a non-conformity with its corrective action.
 *
 * Q5: resolving twice is a 409, not an overwrite — the first resolution is the
 * audit record of who fixed what. A discarded failure cannot be "resolved"
 * either: if it was a false positive, that is its final state.
 */
export async function resolverNoConformidad(
  id: number,
  accionCorrectiva: string,
  usuario: string,
): Promise<ResultadoResolucion> {
  const ncId = entero(id, "id");
  const accion = textoRequerido(accionCorrectiva, "Acción correctiva", { max: 2_000 });
  const ahora = ahoraUTC();

  const actualizado = await withTransaction(async (client) => {
    const actual = await client.query<Fila<{ id: number; estado: string }>>(
      "SELECT id, estado FROM no_conformidades WHERE id = $1 FOR UPDATE;",
      [ncId],
    );
    const fila = actual.rows[0];

    if (!fila) throw new ApiError(404, `No existe la no conformidad con id ${ncId}.`);
    if (fila.estado === "Resuelto") {
      throw new ApiError(409, "La no conformidad ya fue marcada como Resuelta.", {
        estado_actual: fila.estado,
      });
    }
    if (fila.estado === "Descartado") {
      throw new ApiError(409, "La no conformidad fue descartada y no se puede resolver.", {
        estado_actual: fila.estado,
      });
    }

    await client.query(
      `UPDATE no_conformidades
          SET estado = 'Resuelto', accion_correctiva = $1, resuelto_por = $2,
              fecha_resolucion = $3, fecha_actualizacion = $3
        WHERE id = $4;`,
      [accion, usuario, ahora, ncId],
    );

    const filas = await client.query<Fila<NoConformidadRow>>(`${SQL_NC} WHERE nc.id = $1;`, [ncId]);
    return filas.rows[0];
  });

  return {
    no_conformidad: mapNoConformidad(actualizado),
    resumen: await resumenCalidad(),
  };
}

/** `IN ('En Proceso','Pausado')` — built from the catalog, never hand-typed. */
function ABIERTOS_SQL(): string {
  return `(${ESTADOS_ABIERTOS.map((estado) => `'${estado}'`).join(",")})`;
}
