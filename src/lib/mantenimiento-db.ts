import type { QueryResultRow } from "pg";
import { LOCK_SECTOR, query, withTransaction } from "@/lib/db";
import {
  ApiError,
  booleano,
  decimal,
  entero,
  textoOpcional,
  textoRequerido,
} from "@/lib/http";
import {
  computarMaquina,
  r2,
  type HistorialMantenimiento,
  type MaquinaTPM,
  type MaquinaTPMRow,
  type ResumenTPM,
} from "@/lib/mantenimiento";
import { ahoraUTC } from "@/lib/produccion";

/*
 * TPM data layer: machines, their live usage hours and the service history.
 *
 * The counter belongs to the SECTOR, not to the machine. A machine stores only
 * a snapshot of the sector's net hours taken at its last service (T1), so the
 * arithmetic is `horas netas del sector - snapshot` and never a stateful
 * counter that could drift. `computarMaquina` does that in the pure module.
 *
 * Writes take `LOCK_SECTOR` (T5): two technicians registering a service at the
 * same time must not snapshot a half-updated accumulator.
 */

type Fila<T> = T & QueryResultRow;

const MAX_HISTORIAL = 500;

const SQL_MAQUINAS = `
  SELECT m.*, s.nombre_sector, s.linea_area
    FROM maquinas_tpm m
    JOIN sectores s ON s.id = m.sector_id`;

/** Unique-index violation (`uq_tpm_sector_maquina`). */
function esNombreDuplicado(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

/* -------------------------------------------------------------------------- */
/* Net hours                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * T1: net hours accumulated per sector.
 *
 * Only `Finalizado` stages count, and `duracion_minutos` already discounts
 * pauses, so maintenance is scheduled by real productive use and not by the
 * calendar. One GROUP BY feeds every machine in the list (no N+1).
 */
export async function horasPorSector(): Promise<Map<number, number>> {
  const filas = await query<Fila<{ sector_id: number; minutos: number }>>(
    `SELECT sector_id, COALESCE(SUM(duracion_minutos), 0) AS minutos
       FROM registros_tiempos
      WHERE estado_etapa = 'Finalizado'
      GROUP BY sector_id;`,
  );

  const mapa = new Map<number, number>();
  for (const fila of filas.rows) {
    mapa.set(Number(fila.sector_id), Number(fila.minutos ?? 0) / 60);
  }
  return mapa;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export interface ListadoMantenimiento {
  maquinas: MaquinaTPM[];
  historial: HistorialMantenimiento[];
  resumen: ResumenTPM;
}

function resumir(maquinas: MaquinaTPM[]): ResumenTPM {
  const resumen: ResumenTPM = {
    total: maquinas.length,
    ok: 0,
    advertencia: 0,
    critico: 0,
    inactivas: 0,
  };

  for (const maquina of maquinas) {
    if (!maquina.activo) resumen.inactivas += 1;
    resumen[maquina.estado] += 1;
  }

  return resumen;
}

function mapHistorial(fila: HistorialMantenimiento & QueryResultRow): HistorialMantenimiento {
  return {
    id: Number(fila.id),
    maquina_tpm_id: Number(fila.maquina_tpm_id),
    nombre_maquina: fila.nombre_maquina ?? null,
    tarea_mantenimiento: fila.tarea_mantenimiento ?? null,
    nombre_sector: fila.nombre_sector ?? null,
    tecnico_operario: String(fila.tecnico_operario ?? ""),
    fecha_hora: String(fila.fecha_hora ?? ""),
    horas_acumuladas_al_service: r2(fila.horas_acumuladas_al_service),
    observaciones: fila.observaciones ?? null,
  };
}

/** Admin list: every machine (T4, inactive included) plus its recent history. */
export async function listarMantenimiento(): Promise<ListadoMantenimiento> {
  const [maquinasRows, historialRows, mapa] = await Promise.all([
    query<Fila<MaquinaTPMRow>>(
      `${SQL_MAQUINAS}
       ORDER BY s.orden_flujo, s.nombre_sector, m.nombre_maquina;`,
    ),
    query<Fila<HistorialMantenimiento>>(
      `SELECT h.id, h.maquina_tpm_id, h.tecnico_operario, h.fecha_hora,
              h.horas_acumuladas_al_service, h.observaciones,
              m.nombre_maquina, m.tarea_mantenimiento, s.nombre_sector
         FROM historial_mantenimiento h
         JOIN maquinas_tpm m ON m.id = h.maquina_tpm_id
         JOIN sectores s     ON s.id = m.sector_id
        ORDER BY h.fecha_hora DESC, h.id DESC
        LIMIT ${MAX_HISTORIAL};`,
    ),
    horasPorSector(),
  ]);

  const maquinas = maquinasRows.rows.map((fila) =>
    computarMaquina(fila, mapa.get(Number(fila.sector_id)) ?? 0),
  );

  return {
    maquinas,
    historial: historialRows.rows.map(mapHistorial),
    resumen: resumir(maquinas),
  };
}

export interface EstadoMantenimiento {
  maquinas: MaquinaTPM[];
  criticas: MaquinaTPM[];
  advertencias: MaquinaTPM[];
}

/**
 * Terminal view (T4): active machines only, no history.
 *
 * The terminal already downloads orders and sectors; this payload has to stay
 * small because it is fetched on every screen load of a plant tablet.
 */
export async function estadoMantenimiento(): Promise<EstadoMantenimiento> {
  const [maquinasRows, mapa] = await Promise.all([
    query<Fila<MaquinaTPMRow>>(
      `${SQL_MAQUINAS}
        WHERE m.activo = 1
        ORDER BY s.orden_flujo, m.nombre_maquina;`,
    ),
    horasPorSector(),
  ]);

  const maquinas = maquinasRows.rows.map((fila) =>
    computarMaquina(fila, mapa.get(Number(fila.sector_id)) ?? 0),
  );

  return {
    maquinas,
    criticas: maquinas.filter((maquina) => maquina.estado === "critico"),
    advertencias: maquinas.filter((maquina) => maquina.estado === "advertencia"),
  };
}

/* -------------------------------------------------------------------------- */
/* Register a service (rule T3)                                                */
/* -------------------------------------------------------------------------- */

export interface ResultadoMantenimiento {
  maquina: MaquinaTPM;
  historial_id: number;
  horas_acumuladas_al_service: number;
  horas_desde_ultimo_mantenimiento: number;
}

/**
 * Registers a service.
 *
 * T3: the accumulator is NOT reset. The service stores the current net hours
 * as the new baseline and writes a history row; "hours since the last service"
 * then reads 0 while the machine's lifetime hours stay intact. That is the
 * whole point of a snapshot: no information is destroyed.
 *
 * The accumulator is re-read INSIDE the transaction, after the advisory lock,
 * so the snapshot matches exactly what the plant had when the service closed.
 */
export async function registrarMantenimiento(
  entrada: Record<string, unknown>,
): Promise<ResultadoMantenimiento> {
  const id = entero(entrada.maquina_tpm_id, "maquina_tpm_id");
  const tecnico = textoRequerido(entrada.tecnico_operario, "Técnico / Operario", { max: 120 });
  const observaciones = textoOpcional(entrada.observaciones, "Observaciones", { max: 1_000 });

  const maquina = await query<Fila<{ id: number; sector_id: number }>>(
    "SELECT id, sector_id FROM maquinas_tpm WHERE id = $1;",
    [id],
  );
  const fila = maquina.rows[0];
  if (!fila) throw new ApiError(404, `No existe la máquina TPM con id ${id}.`);

  const sectorId = Number(fila.sector_id);
  const ahora = ahoraUTC();

  const resultado = await withTransaction(
    async (client) => {
      const acumulado = await client.query<Fila<{ minutos: number }>>(
        `SELECT COALESCE(SUM(duracion_minutos), 0) AS minutos
           FROM registros_tiempos
          WHERE sector_id = $1 AND estado_etapa = 'Finalizado';`,
        [sectorId],
      );
      const horas = Number(acumulado.rows[0]?.minutos ?? 0) / 60;

      await client.query(
        `UPDATE maquinas_tpm
            SET horas_ultimo_mantenimiento = $1, fecha_actualizacion = $2
          WHERE id = $3;`,
        [horas, ahora, id],
      );

      const historial = await client.query<Fila<{ id: number }>>(
        `INSERT INTO historial_mantenimiento
           (maquina_tpm_id, tecnico_operario, fecha_hora,
            horas_acumuladas_al_service, observaciones, fecha_creacion)
         VALUES ($1, $2, $3, $4, $5, $3)
         RETURNING id;`,
        [id, tecnico, ahora, horas, observaciones],
      );

      const actualizada = await client.query<Fila<MaquinaTPMRow>>(
        `${SQL_MAQUINAS} WHERE m.id = $1;`,
        [id],
      );

      return {
        historialId: Number(historial.rows[0].id),
        horas,
        maquina: computarMaquina(actualizada.rows[0], horas),
      };
    },
    [[LOCK_SECTOR, sectorId]],
  );

  return {
    maquina: resultado.maquina,
    historial_id: resultado.historialId,
    horas_acumuladas_al_service: r2(resultado.horas),
    horas_desde_ultimo_mantenimiento: 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Configure a machine                                                         */
/* -------------------------------------------------------------------------- */

export interface ResultadoConfiguracion {
  id: number;
  creada: boolean;
}

/**
 * Creates or edits a machine.
 *
 * Optional fields that were not sent keep their stored value: a form that only
 * changes the target hours must not resurrect a deactivated machine nor wipe
 * the baseline (which would fire a false critical alarm, T2).
 *
 * The duplicate name check mirrors the unique index `uq_tpm_sector_maquina`
 * (`lower(nombre_maquina)` per sector); the index is still the last line of
 * defence and its violation is translated to the same 409.
 */
export async function configurarMaquina(
  entrada: Record<string, unknown>,
): Promise<ResultadoConfiguracion> {
  const sectorId = entero(entrada.sector_id, "sector_id");
  const nombre = textoRequerido(entrada.nombre_maquina, "nombre_maquina", { max: 160 });
  const tarea = textoRequerido(entrada.tarea_mantenimiento, "tarea_mantenimiento", { max: 300 });
  const intervalo = decimal(entrada.intervalo_horas_target, "intervalo_horas_target", {
    requerido: true,
    min: 1,
    max: 100_000,
  });

  const horasBase =
    entrada.horas_ultimo_mantenimiento === undefined ||
    entrada.horas_ultimo_mantenimiento === null ||
    entrada.horas_ultimo_mantenimiento === ""
      ? null
      : decimal(entrada.horas_ultimo_mantenimiento, "horas_ultimo_mantenimiento", {
          min: 0,
          max: 10_000_000,
        });

  const activo =
    entrada.activo === undefined || entrada.activo === null || entrada.activo === ""
      ? null
      : booleano(entrada.activo, true)
        ? 1
        : 0;

  const id =
    entrada.id === undefined || entrada.id === null || entrada.id === ""
      ? null
      : entero(entrada.id, "id");

  const sector = await query<Fila<{ id: number; nombre_sector: string }>>(
    "SELECT id, nombre_sector FROM sectores WHERE id = $1;",
    [sectorId],
  );
  const nombreSector = sector.rows[0]?.nombre_sector;
  if (!nombreSector) throw new ApiError(404, `No existe el sector con id ${sectorId}.`);

  const actual = id
    ? await query<Fila<{ id: number; sector_id: number; horas_ultimo_mantenimiento: number; activo: number }>>(
        "SELECT id, sector_id, horas_ultimo_mantenimiento, activo FROM maquinas_tpm WHERE id = $1;",
        [id],
      )
    : null;

  if (id && !actual?.rows[0]) {
    throw new ApiError(404, `No existe la máquina TPM con id ${id}.`);
  }

  const sectorAnterior = actual?.rows[0] ? Number(actual.rows[0].sector_id) : sectorId;

  const ahora = ahoraUTC();

  try {
    return await withTransaction(
      async (client) => {
        const choque = await client.query<Fila<{ id: number }>>(
          `SELECT id FROM maquinas_tpm
            WHERE sector_id = $1 AND lower(nombre_maquina) = lower($2)
              AND ($3::bigint IS NULL OR id <> $3);`,
          [sectorId, nombre, id],
        );

        if (choque.rows[0]) {
          throw new ApiError(
            409,
            `Ya existe una máquina llamada "${nombre}" en el sector ${nombreSector}.`,
            { accion: "Renombre la máquina nueva o edite la existente." },
          );
        }

        if (id && actual?.rows[0]) {
          await client.query(
            `UPDATE maquinas_tpm
                SET sector_id = $1, nombre_maquina = $2, tarea_mantenimiento = $3,
                    intervalo_horas_target = $4, horas_ultimo_mantenimiento = $5,
                    activo = $6, fecha_actualizacion = $7
              WHERE id = $8;`,
            [
              sectorId,
              nombre,
              tarea,
              intervalo,
              horasBase === null
                ? Number(actual.rows[0].horas_ultimo_mantenimiento || 0)
                : horasBase,
              activo === null ? Number(actual.rows[0].activo || 0) : activo,
              ahora,
              id,
            ],
          );

          return { id, creada: false };
        }

        const insertada = await client.query<Fila<{ id: number }>>(
          `INSERT INTO maquinas_tpm
             (sector_id, nombre_maquina, tarea_mantenimiento, intervalo_horas_target,
              horas_ultimo_mantenimiento, activo, fecha_creacion, fecha_actualizacion)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
           RETURNING id;`,
          [
            sectorId,
            nombre,
            tarea,
            intervalo,
            horasBase === null ? 0 : horasBase,
            activo === null ? 1 : activo,
            ahora,
          ],
        );

        return { id: Number(insertada.rows[0].id), creada: true };
      },
      [
        [LOCK_SECTOR, sectorId],
        [LOCK_SECTOR, sectorAnterior],
      ],
    );
  } catch (error) {
    if (esNombreDuplicado(error)) {
      throw new ApiError(
        409,
        `Ya existe una máquina llamada "${nombre}" en el sector ${nombreSector}.`,
        { accion: "Renombre la máquina nueva o edite la existente." },
      );
    }
    throw error;
  }
}
