import { query } from "@/lib/db";
import {
  correrDias,
  diaLocal,
  diasEntre,
  etiquetaDia,
  hoyLocal,
  inicioMesSiguiente,
  periodoActual,
  ventanaLocalUTC,
} from "@/lib/fechas-planta";
import { MOTIVOS_REPROCESO, type LineaOT } from "@/lib/produccion";

/*
 * Executive metrics for the analytics dashboard.
 *
 * Business definitions are ported from the legacy `server/routes/metricas.js`
 * and `public/js/admin.js` so the new dashboard and the old one never disagree:
 *
 *   · Lead time  — MIN(start) of the order's OWN line flow -> MAX(end) of that
 *                  same flow. Only orders closed at both ends are measured.
 *   · FTT        — % of orders that advanced in the period without a rework
 *                  pause ("Error de plano", "Rotura de placa").
 *   · Standby    — dead time between the end of one stage and the start of the
 *                  next inside the same order (the handover between sectors).
 *                  Gaps outside `(0, 24 h]` are ignored so weekends do not
 *                  poison the average; the mean is per order with a handover.
 *   · Metres     — SUM(metros_lineales) of the orders whose FIRST regular
 *                  sector of their line started or finished inside the month.
 *
 * Timestamps are ISO-8601 text columns, so every duration is computed in JS:
 * comparing them lexicographically in SQL is fine, but arithmetic is not.
 */

/** Rolling window used by the KPI strip and the sector chart. */
const DIAS_VENTANA = 30;

/** Fallback goal for the current month, mirrored from the legacy backend. */
const META_DEFECTO = {
  meta_metros_totales: 1200,
  meta_metros_placares: 800,
  meta_metros_cocinas: 400,
} as const;

/** Minutes in a day, used to cap a standby gap. */
const MINUTOS_DIA = 1440;

export interface HorasSector {
  sector_id: number;
  nombre_sector: string;
  nombre_corto: string;
  linea_area: string;
  /** Net hours consumed by the closed stages in the window. */
  horas: number;
  etapas: number;
}

export interface AvanceLinea {
  linea: LineaOT;
  cortados: number;
  meta: number;
  porcentaje: number | null;
}

export interface PuntoSerieMetros {
  /** `dd/mm` label for the axis. */
  dia: string;
  metros: number;
  acumulado: number;
  ideal: number;
}

export interface MetricasDashboard {
  periodo: { desde: string; hasta: string; dias: number };
  lead_time: {
    ots_medidas: number;
    promedio_minutos: number | null;
  };
  ftt: {
    evaluadas: number;
    conformes: number;
    porcentaje: number | null;
    motivos: readonly string[];
  };
  standby: {
    ots_con_traspaso: number;
    traspasos: number;
    total_minutos: number;
    promedio_minutos: number | null;
  };
  horas_por_sector: HorasSector[];
  metros: {
    periodo: string;
    total: number;
    meta_total: number;
    meta_configurada: boolean;
    porcentaje: number | null;
    por_linea: AvanceLinea[];
    serie: PuntoSerieMetros[];
  };
}

/* -------------------------------------------------------------------------- */
/* Row shapes                                                                  */
/* -------------------------------------------------------------------------- */

interface FilaLeadTime {
  inicio_flujo: string;
  fin_flujo: string;
}

interface FilaFTT {
  evaluadas: number;
  conformes: number;
}

interface FilaRegistro {
  id: number;
  ot_id: number;
  sector_id: number;
  fecha_hora_inicio: string;
  fecha_hora_fin: string | null;
  duracion_minutos: number | null;
  nombre_sector: string;
  nombre_corto: string;
  linea_area: string;
}

interface FilaCorte {
  linea_area: string;
  metros_lineales: number;
  inicio_corte: string;
  fin_corte: string | null;
}

interface FilaObjetivo {
  meta_metros_totales: number;
  meta_metros_placares: number;
  meta_metros_cocinas: number;
}

/* -------------------------------------------------------------------------- */
/* Small numeric helpers                                                       */
/* -------------------------------------------------------------------------- */

const red1 = (valor: number): number => Math.round(valor * 10) / 10;
const red2 = (valor: number): number => Math.round(valor * 100) / 100;

function minutosEntre(inicioISO: string, finISO: string): number | null {
  const inicio = Date.parse(inicioISO);
  const fin = Date.parse(finISO);
  if (!Number.isFinite(inicio) || !Number.isFinite(fin)) return null;
  return (fin - inicio) / 60_000;
}

/* -------------------------------------------------------------------------- */
/* Metric blocks                                                               */
/* -------------------------------------------------------------------------- */

async function metricasLeadTime(desdeUTC: string, hastaUTC: string) {
  const filas = await query<FilaLeadTime>(
    `SELECT MIN(r.fecha_hora_inicio) AS inicio_flujo,
            MAX(r.fecha_hora_fin)    AS fin_flujo
       FROM ordenes_trabajo o
       JOIN registros_tiempos r ON r.ot_id = o.id
       JOIN sectores s          ON s.id = r.sector_id
      WHERE s.linea_area = o.linea_area
        AND o.fecha_creacion >= $1 AND o.fecha_creacion < $2
      GROUP BY o.id
     HAVING MIN(r.fecha_hora_inicio) IS NOT NULL
        AND MAX(r.fecha_hora_fin) IS NOT NULL;`,
    [desdeUTC, hastaUTC],
  );

  let suma = 0;
  let medidas = 0;

  for (const fila of filas.rows) {
    const minutos = minutosEntre(String(fila.inicio_flujo), String(fila.fin_flujo));
    if (minutos === null) continue;
    suma += minutos;
    medidas += 1;
  }

  return {
    ots_medidas: medidas,
    promedio_minutos: medidas ? red1(suma / medidas) : null,
  };
}

async function metricasFTT(desdeUTC: string, hastaUTC: string) {
  const fila = await query<FilaFTT>(
    `WITH avanzadas AS (
       SELECT DISTINCT r.ot_id
         FROM registros_tiempos r
        WHERE r.estado_etapa = 'Finalizado'
          AND r.fecha_hora_inicio >= $1 AND r.fecha_hora_inicio < $2
     )
     SELECT COUNT(*) AS evaluadas,
            COALESCE(SUM(CASE WHEN NOT EXISTS (
                   SELECT 1
                     FROM registros_tiempos r2
                     JOIN eventos_pausa ep ON ep.registro_id = r2.id
                    WHERE r2.ot_id = avanzadas.ot_id
                      AND ep.motivo_pausa = ANY($3::text[])
                 ) THEN 1 ELSE 0 END), 0) AS conformes
       FROM avanzadas;`,
    [desdeUTC, hastaUTC, [...MOTIVOS_REPROCESO]],
  );

  const evaluadas = Number(fila.rows[0]?.evaluadas ?? 0);
  const conformes = Number(fila.rows[0]?.conformes ?? 0);

  return {
    evaluadas,
    conformes,
    porcentaje: evaluadas > 0 ? red1((conformes / evaluadas) * 100) : null,
    motivos: MOTIVOS_REPROCESO,
  };
}

/**
 * One round trip feeds two blocks: net hours per sector and the standby gaps
 * between consecutive stages of the same order.
 */
function horasYStandby(filas: FilaRegistro[]): {
  horas_por_sector: HorasSector[];
  standby: MetricasDashboard["standby"];
} {
  const porSector = new Map<number, HorasSector>();

  for (const fila of filas) {
    const neto = fila.fecha_hora_fin
      ? (fila.duracion_minutos ?? minutosEntre(fila.fecha_hora_inicio, fila.fecha_hora_fin))
      : null;

    if (neto === null || neto <= 0) continue;

    const actual = porSector.get(fila.sector_id) ?? {
      sector_id: fila.sector_id,
      nombre_sector: fila.nombre_sector,
      nombre_corto: fila.nombre_corto || fila.nombre_sector,
      linea_area: fila.linea_area || "General",
      horas: 0,
      etapas: 0,
    };

    actual.horas += neto / 60;
    actual.etapas += 1;
    porSector.set(fila.sector_id, actual);
  }

  const horas_por_sector = [...porSector.values()]
    .map((sector) => ({ ...sector, horas: red1(sector.horas) }))
    .sort((a, b) => b.horas - a.horas || a.nombre_sector.localeCompare(b.nombre_sector));

  // The rows arrive ordered by order + start, so one pass is enough.
  const porOT = new Map<number, FilaRegistro[]>();
  for (const fila of filas) {
    const lista = porOT.get(fila.ot_id);
    if (lista) lista.push(fila);
    else porOT.set(fila.ot_id, [fila]);
  }

  let totalMinutos = 0;
  let traspasos = 0;
  let otsConTraspaso = 0;

  for (const etapas of porOT.values()) {
    let minutosOT = 0;

    for (let i = 0; i < etapas.length - 1; i += 1) {
      const fin = etapas[i].fecha_hora_fin;
      const siguienteInicio = etapas[i + 1].fecha_hora_inicio;
      if (!fin || !siguienteInicio) continue;

      const hueco = minutosEntre(fin, siguienteInicio);
      if (hueco === null || hueco <= 0 || hueco > MINUTOS_DIA) continue;

      minutosOT += hueco;
      traspasos += 1;
    }

    if (minutosOT > 0) {
      totalMinutos += minutosOT;
      otsConTraspaso += 1;
    }
  }

  return {
    horas_por_sector,
    standby: {
      ots_con_traspaso: otsConTraspaso,
      traspasos,
      total_minutos: Math.round(totalMinutos),
      promedio_minutos: otsConTraspaso ? Math.round(totalMinutos / otsConTraspaso) : null,
    },
  };
}

/** Day the metres of an order are credited to, clamped to the elapsed month. */
function diaAcreditado(inicioCorte: string, mesInicio: string, ultimoDia: string): string {
  let dia = diaLocal(inicioCorte) || mesInicio;
  if (dia < mesInicio) dia = mesInicio;
  if (dia > ultimoDia) dia = ultimoDia;
  return dia;
}

async function metricasMetros() {
  const periodo = periodoActual();
  const mesInicio = `${periodo}-01`;
  const mesFin = inicioMesSiguiente(periodo);
  const hoy = hoyLocal();

  const diasTotales = Math.max(1, diasEntre(mesInicio, mesFin));
  const diasTranscurridos = Math.min(diasTotales, Math.max(0, diasEntre(mesInicio, hoy) + 1));
  const ultimoDia = diasTranscurridos > 0 ? correrDias(mesInicio, diasTranscurridos - 1) : mesInicio;

  // Goal read + fallback: a Server Component must not INSERT, so the current
  // month falls back to the defaults instead of seeding the row.
  const objetivo = await query<FilaObjetivo>(
    `SELECT meta_metros_totales, meta_metros_placares, meta_metros_cocinas
       FROM objetivos_produccion
      WHERE periodo = $1;`,
    [periodo],
  );

  const filaObjetivo = objetivo.rows[0];
  const meta = {
    total: Number(filaObjetivo?.meta_metros_totales ?? META_DEFECTO.meta_metros_totales),
    placares: Number(filaObjetivo?.meta_metros_placares ?? META_DEFECTO.meta_metros_placares),
    cocinas: Number(filaObjetivo?.meta_metros_cocinas ?? META_DEFECTO.meta_metros_cocinas),
  };

  // `[start of the month, start of the next month)`, in plant-local instants.
  // The query takes the UPPER bound first because it reads "started before the
  // end of the month" before "finished after the beginning of it".
  const [mesInicioUTC, mesFinUTC] = ventanaLocalUTC(mesInicio, correrDias(mesFin, -1));

  const filas = await query<FilaCorte>(
    `SELECT o.linea_area,
            o.metros_lineales,
            MIN(r.fecha_hora_inicio) AS inicio_corte,
            MAX(r.fecha_hora_fin)    AS fin_corte
       FROM ordenes_trabajo o
       JOIN registros_tiempos r ON r.ot_id = o.id
       JOIN sectores s          ON s.id = r.sector_id
      WHERE s.activo = 1
        AND s.clave_especial IS NULL
        AND s.linea_area = o.linea_area
        AND s.orden_flujo = (
              SELECT MIN(s2.orden_flujo)
                FROM sectores s2
               WHERE s2.activo = 1
                 AND s2.clave_especial IS NULL
                 AND s2.linea_area = o.linea_area
            )
      GROUP BY o.id, o.numero_ot, o.metros_lineales, o.linea_area
     HAVING MIN(r.fecha_hora_inicio) < $1
        AND (MAX(r.fecha_hora_fin) IS NULL OR MAX(r.fecha_hora_fin) >= $2);`,
    [mesFinUTC, mesInicioUTC],
  );

  const porDia = new Map<string, number>();
  const porLinea: Record<LineaOT, number> = { Placares: 0, Cocinas: 0 };
  let total = 0;

  for (const fila of filas.rows) {
    const metros = Number(fila.metros_lineales || 0);
    total += metros;

    if (fila.linea_area === "Placares" || fila.linea_area === "Cocinas") {
      porLinea[fila.linea_area] += metros;
    }

    const dia = diaAcreditado(String(fila.inicio_corte), mesInicio, ultimoDia);
    porDia.set(dia, (porDia.get(dia) ?? 0) + metros);
  }

  const idealDiario = meta.total > 0 ? meta.total / diasTotales : 0;
  const serie: PuntoSerieMetros[] = [];
  let acumulado = 0;

  for (let i = 0; i < diasTranscurridos; i += 1) {
    const dia = correrDias(mesInicio, i);
    const metros = red2(porDia.get(dia) ?? 0);
    acumulado += metros;

    serie.push({
      dia: etiquetaDia(dia),
      metros,
      acumulado: red2(acumulado),
      ideal: red2(idealDiario * (i + 1)),
    });
  }

  return {
    periodo,
    total: red2(total),
    meta_total: red2(meta.total),
    meta_configurada: Boolean(filaObjetivo),
    porcentaje: meta.total > 0 ? red2((total / meta.total) * 100) : null,
    por_linea: [
      {
        linea: "Placares" as LineaOT,
        cortados: red2(porLinea.Placares),
        meta: red2(meta.placares),
        porcentaje: meta.placares > 0 ? red2((porLinea.Placares / meta.placares) * 100) : null,
      },
      {
        linea: "Cocinas" as LineaOT,
        cortados: red2(porLinea.Cocinas),
        meta: red2(meta.cocinas),
        porcentaje: meta.cocinas > 0 ? red2((porLinea.Cocinas / meta.cocinas) * 100) : null,
      },
    ],
    serie,
  };
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

/** Global production metrics for the analytics dashboard. */
export async function calcularMetricas(): Promise<MetricasDashboard> {
  const hasta = hoyLocal();
  const desde = correrDias(hasta, -(DIAS_VENTANA - 1));
  const [desdeUTC, hastaUTC] = ventanaLocalUTC(desde, hasta);

  const [leadTime, ftt, registros] = await Promise.all([
    metricasLeadTime(desdeUTC, hastaUTC),
    metricasFTT(desdeUTC, hastaUTC),
    query<FilaRegistro>(
      `SELECT r.id, r.ot_id, r.sector_id,
              r.fecha_hora_inicio, r.fecha_hora_fin, r.duracion_minutos,
              s.nombre_sector, s.nombre_corto, s.linea_area
         FROM registros_tiempos r
         JOIN sectores s ON s.id = r.sector_id
        WHERE r.fecha_hora_inicio >= $1 AND r.fecha_hora_inicio < $2
        ORDER BY r.ot_id, r.fecha_hora_inicio, r.id;`,
      [desdeUTC, hastaUTC],
    ),
  ]);

  // Metres are a month-to-date block: it queries its own window and goals.
  const metros = await metricasMetros();
  const { horas_por_sector, standby } = horasYStandby(registros.rows);

  return {
    periodo: { desde, hasta, dias: DIAS_VENTANA },
    lead_time: leadTime,
    ftt,
    standby,
    horas_por_sector,
    metros,
  };
}
