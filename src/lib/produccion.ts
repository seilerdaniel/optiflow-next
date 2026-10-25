/*
 * Production domain.
 *
 * Types, row mappers and the PURE business rules that govern the plant flow
 * (R1-R8) plus the batch assembly used by the order list.
 *
 * This module MUST stay free of `pg`, `node:crypto` and any other Node-only
 * import: the terminal components (client) and the route handlers (server)
 * both consume it.
 */

/* -------------------------------------------------------------------------- */
/* Catalogs                                                                    */
/* -------------------------------------------------------------------------- */

export const LINEAS_AREA = ["Placares", "Cocinas", "Compartido", "General"] as const;
export type LineaArea = (typeof LINEAS_AREA)[number];

export const LINEAS_OT = ["Placares", "Cocinas"] as const;
export type LineaOT = (typeof LINEAS_OT)[number];

export const ESTADOS_OT = ["En Cola", "En Producción", "Detenido", "Finalizado"] as const;
export type EstadoOT = (typeof ESTADOS_OT)[number];

export const ESTADOS_ETAPA = ["En Proceso", "Pausado", "Finalizado"] as const;
export type EstadoEtapa = (typeof ESTADOS_ETAPA)[number];

/** Stages that have not been closed yet (working or paused). */
export const ESTADOS_ABIERTOS = ["En Proceso", "Pausado"] as const;

export const MOTIVOS_PAUSA = [
  "Falta de herrajes",
  "Error de plano",
  "Ajuste de herramienta",
  "Rotura de placa",
  "Otro",
] as const;
export type MotivoPausa = (typeof MOTIVOS_PAUSA)[number];

/**
 * Pauses that count as rework for the FTT index: the stage had to be repeated
 * because of a planning or material defect, not because of a normal stop.
 */
export const MOTIVOS_REPROCESO = ["Error de plano", "Rotura de placa"] as const;

export const CLAVES_ESPECIALES = ["vidrio", "lustre", "herreria", "especiales"] as const;
export type ClaveEspecial = (typeof CLAVES_ESPECIALES)[number];

/** Sector that requires every special the OT asked for (rule R6/P3). */
const SECTOR_CONTROL = "Control de Calidad";

/** Plant time zone: all operator-facing timestamps are rendered in it. */
export const ZONA_PLANTA = "America/Argentina/Buenos_Aires";

/* -------------------------------------------------------------------------- */
/* Domain types                                                                */
/* -------------------------------------------------------------------------- */

export interface Sector {
  id: number;
  nombre_sector: string;
  nombre_corto: string;
  es_compartido: boolean;
  clave_especial: ClaveEspecial | null;
  linea_area: LineaArea;
  orden_flujo: number;
  /** Free text, e.g. "Joel, Tiago"; null when there are no suggested names. */
  operarios_sugeridos: string | null;
  activo: boolean;
  /**
   * Minutes of work per linear metre used to compute the suggested time.
   * See `estandarSector` for where this value comes from.
   */
  estandar_min_por_metro: number;
  /** Live activity (only present on `GET /api/sectores`). */
  etapas_abiertas?: number;
  ordenes_activas?: string[];
}

export interface OrdenTrabajo {
  id: number;
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
  fecha_creacion: string;
  fecha_actualizacion: string;
}

export interface RegistroTiempo {
  id: number;
  ot_id: number;
  sector_id: number;
  operario_nombre: string;
  fecha_hora_inicio: string;
  fecha_hora_fin: string | null;
  duracion_minutos: number | null;
  /** `duracion_minutos / 60`; one operator per stage, so hours = minutes / 60. */
  horas_hombre: number | null;
  estado_etapa: EstadoEtapa;
  motivo_pausa: MotivoPausa | null;
  observacion: string | null;
  pausa_inicio: string | null;
  segundos_pausados: number;
  numero_ot?: string;
  cliente?: string;
  modelo?: string;
  nombre_sector?: string;
  nombre_corto?: string;
}

export interface Operario {
  id: number;
  nombre: string;
  activo: boolean;
  fecha_creacion: string;
  etapas: number;
  etapas_abiertas: number;
  ultima_actividad: string | null;
}

export interface MaterialOT {
  id: number;
  ot_id: number;
  material_nombre: string;
  cantidad_placas: number;
  cantidad_consumida: number;
  placas_restantes: number;
  observaciones: string | null;
  fecha_actualizacion: string;
}

export interface ResumenMateriales {
  lineas: number;
  placas_requeridas: number;
  placas_consumidas: number;
  placas_restantes: number;
  porcentaje_consumo: number;
}

export interface AlertaNoConformidad {
  id: number;
  ot_id: number;
  sector_id: number | null;
  nombre_sector: string | null;
  tipo_falla: string;
  estado: string;
  accion_correctiva: string | null;
  fecha_registro: string | null;
}

/** An order enriched with its progress, assembled from the batch queries. */
export interface OrdenConProgreso extends OrdenTrabajo {
  sectores_requeridos: number[];
  progreso: {
    sectores_requeridos: number;
    sectores_finalizados: number;
    porcentaje: number;
    finalizados_ids: number[];
  };
  minutos_acumulados: number;
  etapa_activa: RegistroTiempo | null;
  /** sector_id -> human readable reason it cannot be started yet. */
  sectores_bloqueados: Record<number, string>;
  sector_actual: {
    id: number;
    sector_id: number;
    nombre_sector: string | null;
    nombre_corto: string | null;
    estado_etapa: EstadoEtapa;
    fecha_hora_inicio: string;
  } | null;
  etapas_completadas: number[];
  total_etapas_completadas: number;
  materiales: MaterialOT[];
  resumen_materiales: ResumenMateriales;
  alertas: AlertaNoConformidad[];
  alertas_abiertas: number;
}

/** The order plus everything the detail screen needs. */
export interface DetalleOrden {
  ot: OrdenConProgreso;
  registros: RegistroTiempo[];
  sectores: Sector[];
}

/* -------------------------------------------------------------------------- */
/* Row shapes (what `pg` hands back)                                           */
/* -------------------------------------------------------------------------- */

export interface SectorRow {
  id: number;
  nombre_sector: string;
  nombre_corto: string;
  es_compartido: number | boolean | null;
  clave_especial: string | null;
  linea_area: string | null;
  orden_flujo: number | string | null;
  operarios_sugeridos: string | null;
  activo: number | boolean | null;
}

export interface OrdenRow {
  id: number;
  numero_ot: string;
  cliente: string;
  modelo: string | null;
  linea_area: string | null;
  metros_lineales: number | string | null;
  fecha_prometida: string | null;
  requiere_vidrio: number | boolean | null;
  requiere_lustre: number | boolean | null;
  requiere_herreria: number | boolean | null;
  requiere_especiales: number | boolean | null;
  estado_general: string;
  fecha_creacion: string;
  fecha_actualizacion: string;
}

export interface RegistroRow {
  id: number;
  ot_id: number;
  sector_id: number;
  operario_nombre: string;
  fecha_hora_inicio: string;
  fecha_hora_fin: string | null;
  duracion_minutos: number | string | null;
  estado_etapa: string;
  motivo_pausa: string | null;
  observacion: string | null;
  pausa_inicio: string | null;
  segundos_pausados: number | string | null;
  numero_ot?: string;
  cliente?: string;
  modelo?: string;
  nombre_sector?: string;
  nombre_corto?: string;
}

export interface OperarioRow {
  id: number;
  nombre: string;
  activo: number | boolean | null;
  fecha_creacion: string;
  etapas?: number | string | null;
  etapas_abiertas?: number | string | null;
  ultima?: string | null;
}

export interface MaterialRow {
  id: number;
  ot_id: number;
  material_nombre: string;
  cantidad_placas: number | string;
  cantidad_consumida: number | string | null;
  observaciones: string | null;
  fecha_actualizacion: string;
}

/* -------------------------------------------------------------------------- */
/* Mappers                                                                     */
/* -------------------------------------------------------------------------- */

function texto(valor: unknown): string {
  return valor === null || valor === undefined ? "" : String(valor);
}

function numero(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function booleano(valor: unknown): boolean {
  return valor === true || valor === 1 || valor === "1" || valor === "t" || valor === "true";
}

function redondear(valor: number, decimales = 2): number {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
}

export function mapSector(row: SectorRow): Sector {
  const linea = texto(row.linea_area) as LineaArea;
  return {
    id: numero(row.id),
    nombre_sector: texto(row.nombre_sector),
    nombre_corto: texto(row.nombre_corto),
    es_compartido: booleano(row.es_compartido),
    clave_especial: (row.clave_especial as ClaveEspecial | null) ?? null,
    linea_area: LINEAS_AREA.includes(linea) ? linea : "General",
    orden_flujo: numero(row.orden_flujo),
    operarios_sugeridos: row.operarios_sugeridos ?? null,
    activo: row.activo === undefined || row.activo === null ? true : booleano(row.activo),
    estandar_min_por_metro: estandarSector(texto(row.nombre_sector)),
  };
}

export function mapOT(row: OrdenRow): OrdenTrabajo {
  const linea = texto(row.linea_area) as LineaOT;
  return {
    id: numero(row.id),
    numero_ot: texto(row.numero_ot),
    cliente: texto(row.cliente),
    modelo: row.modelo ?? null,
    linea_area: LINEAS_OT.includes(linea) ? linea : "Placares",
    metros_lineales: numero(row.metros_lineales),
    fecha_prometida: row.fecha_prometida ?? null,
    requiere_vidrio: booleano(row.requiere_vidrio),
    requiere_lustre: booleano(row.requiere_lustre),
    requiere_herreria: booleano(row.requiere_herreria),
    requiere_especiales: booleano(row.requiere_especiales),
    estado_general: texto(row.estado_general) as EstadoOT,
    fecha_creacion: texto(row.fecha_creacion),
    fecha_actualizacion: texto(row.fecha_actualizacion),
  };
}

export function mapRegistro(row: RegistroRow): RegistroTiempo {
  const duracion =
    row.duracion_minutos === null || row.duracion_minutos === undefined
      ? null
      : numero(row.duracion_minutos);

  return {
    id: numero(row.id),
    ot_id: numero(row.ot_id),
    sector_id: numero(row.sector_id),
    operario_nombre: texto(row.operario_nombre),
    fecha_hora_inicio: texto(row.fecha_hora_inicio),
    fecha_hora_fin: row.fecha_hora_fin ?? null,
    duracion_minutos: duracion,
    horas_hombre: duracion === null ? null : redondear(duracion / 60, 4),
    estado_etapa: texto(row.estado_etapa) as EstadoEtapa,
    motivo_pausa: (row.motivo_pausa as MotivoPausa | null) ?? null,
    observacion: row.observacion ?? null,
    pausa_inicio: row.pausa_inicio ?? null,
    segundos_pausados: numero(row.segundos_pausados),
    numero_ot: row.numero_ot,
    cliente: row.cliente,
    modelo: row.modelo,
    nombre_sector: row.nombre_sector,
    nombre_corto: row.nombre_corto,
  };
}

export function mapOperario(row: OperarioRow): Operario {
  return {
    id: numero(row.id),
    nombre: texto(row.nombre),
    activo: booleano(row.activo),
    fecha_creacion: texto(row.fecha_creacion),
    etapas: numero(row.etapas),
    etapas_abiertas: numero(row.etapas_abiertas),
    ultima_actividad: row.ultima ?? null,
  };
}

export function mapMaterial(row: MaterialRow): MaterialOT {
  const requeridas = numero(row.cantidad_placas);
  const consumidas = numero(row.cantidad_consumida);

  return {
    id: numero(row.id),
    ot_id: numero(row.ot_id),
    material_nombre: texto(row.material_nombre),
    cantidad_placas: requeridas,
    cantidad_consumida: consumidas,
    placas_restantes: Math.max(0, redondear(requeridas - consumidas)),
    observaciones: row.observaciones ?? null,
    fecha_actualizacion: texto(row.fecha_actualizacion),
  };
}

export function resumenMateriales(materiales: MaterialOT[]): ResumenMateriales {
  const requeridas = redondear(materiales.reduce((total, m) => total + m.cantidad_placas, 0));
  const consumidas = redondear(materiales.reduce((total, m) => total + m.cantidad_consumida, 0));

  return {
    lineas: materiales.length,
    placas_requeridas: requeridas,
    placas_consumidas: consumidas,
    placas_restantes: Math.max(0, redondear(requeridas - consumidas)),
    porcentaje_consumo: requeridas > 0 ? Math.round((consumidas / requeridas) * 100) : 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Time                                                                        */
/* -------------------------------------------------------------------------- */

/** Server clock, ISO-8601 UTC. Timestamps are never taken from the browser. */
export function ahoraUTC(): string {
  return new Date().toISOString();
}

/** Net minutes between two instants, discounting paused seconds. */
export function calcularDuracionMinutos(
  inicioISO: string,
  finISO: string,
  segundosPausados: number,
  pausaInicioISO: string | null,
): number {
  const ms = new Date(finISO).getTime() - new Date(inicioISO).getTime();
  let segundos = segundosPausados || 0;

  if (pausaInicioISO) {
    segundos += (new Date(finISO).getTime() - new Date(pausaInicioISO).getTime()) / 1000;
  }

  return Math.max(0, redondear((ms / 1000 - segundos) / 60));
}

/**
 * Net minutes an open stage has consumed so far.
 *
 * While an open pause exists its elapsed time keeps being discounted, so the
 * clock effectively freezes for the operator instead of running on.
 */
export function minutosTranscurridos(
  registro: Pick<
    RegistroTiempo,
    "estado_etapa" | "fecha_hora_inicio" | "pausa_inicio" | "segundos_pausados" | "duracion_minutos"
  >,
  ahoraMs: number,
): number {
  if (registro.estado_etapa === "Finalizado") return registro.duracion_minutos ?? 0;

  const inicioMs = new Date(registro.fecha_hora_inicio).getTime();
  if (!Number.isFinite(inicioMs)) return 0;

  let pausados = registro.segundos_pausados || 0;
  if (registro.pausa_inicio) {
    const pausaMs = new Date(registro.pausa_inicio).getTime();
    if (Number.isFinite(pausaMs)) pausados += (ahoraMs - pausaMs) / 1000;
  }

  return Math.max(0, redondear(((ahoraMs - inicioMs) / 1000 - pausados) / 60));
}

/** `HH:MM:SS` for a duration in minutes (always two digits per field). */
export function formatearDuracion(minutos: number): string {
  const total = Math.max(0, Math.floor(minutos * 60));
  const horas = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const segs = total % 60;

  return [horas, mins, segs].map((parte) => String(parte).padStart(2, "0")).join(":");
}

/** Plant-local wall clock for an ISO instant, e.g. `14:35:02`. */
export function horaLocal(iso: string | null): string {
  if (!iso) return "--:--:--";
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "--:--:--";

  return new Intl.DateTimeFormat("es-AR", {
    timeZone: ZONA_PLANTA,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(fecha);
}

/** `dd/mm/yyyy` in plant time. A `YYYY-MM-DD` value passes through unchanged. */
export function fechaLocal(iso: string | null): string {
  if (!iso) return "—";

  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [anio, mes, dia] = iso.split("-");
    return `${dia}/${mes}/${anio}`;
  }

  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "—";

  return new Intl.DateTimeFormat("es-AR", {
    timeZone: ZONA_PLANTA,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(fecha);
}

/** `dd/mm/yyyy HH:MM` in plant time; `—` for a missing or invalid instant. */
export function fechaHoraLocal(iso: string | null): string {
  if (!iso) return "—";

  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "—";

  return new Intl.DateTimeFormat("es-AR", {
    timeZone: ZONA_PLANTA,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(fecha);
}

/** Compact human duration: `45 min`, `3 h`, `3 h 20 min`. */
export function minutosLegibles(minutos: number): string {
  const total = Math.max(0, Math.round(minutos));
  const horas = Math.floor(total / 60);
  const resto = total % 60;

  if (horas === 0) return `${resto} min`;
  if (resto === 0) return `${horas} h`;
  return `${horas} h ${resto} min`;
}

/* -------------------------------------------------------------------------- */
/* Operator names                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Comparison key for operator names: lowercase, no accents, collapsed spaces.
 * So "juan perez" matches "Juan Pérez" on the master table.
 */
export function claveNormalizada(nombre: string): string {
  return String(nombre || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/* -------------------------------------------------------------------------- */
/* Time standard                                                               */
/* -------------------------------------------------------------------------- */

/*
 * Standard pace per sector, in minutes of work per linear metre.
 *
 * The legacy backend only stored flat "prolonged stage" thresholds
 * (`UMBRALES_MINUTOS`), with no metres dimension, so there is no real standard
 * in the database yet. These values are a starting point sized against the
 * orders currently in the plant (9-45 linear metres). When the production
 * standard is formally defined, add a column to `sectores` and read it here.
 */
const MINUTOS_POR_METRO: Record<string, number> = {
  "Seccionadora / Corte": 1.2,
  "Seccionadora B / Corte Módulos": 1.2,
  Enfiladora: 0.8,
  "Enfilado de Cantos Cocina": 0.8,
  "Pantógrafo CNC / Mecanizado": 1.6,
  "Mecanizado de Puertas de Cocina": 1.6,
  "Armado de Cajoneras": 2.4,
  "Armado de Módulos de Cocina": 2.4,
  "Colocación de Herrajes": 1.8,
  "Secuenciado y Distribución de Piezas": 1.0,
  "Control de Calidad": 0.6,
  "Embalaje Final": 0.7,
  "Puertas de Vidrio": 2.0,
  Lustre: 1.4,
  Herrería: 1.6,
  Especiales: 1.8,
};

/** Fallback pace for sectors that are not in the table. */
export const ESTANDAR_POR_DEFECTO = 1.5;

/** Minimum suggested time: below this the alert would be pure noise. */
const SUGERIDO_MINIMO_MINUTOS = 5;

export function estandarSector(nombreSector: string): number {
  const propio = MINUTOS_POR_METRO[texto(nombreSector)];
  return propio !== undefined && propio > 0 ? propio : ESTANDAR_POR_DEFECTO;
}

/**
 * Suggested limit for a stage: `standard (min/m) x metres (m)`.
 * Rounded to a tenth of a minute and never below five minutes.
 */
export function tiempoSugeridoMinutos(
  estandarMinPorMetro: number,
  metrosLineales: number,
): number {
  const estandar =
    Number.isFinite(estandarMinPorMetro) && estandarMinPorMetro > 0
      ? estandarMinPorMetro
      : ESTANDAR_POR_DEFECTO;
  const metros = Number.isFinite(metrosLineales) ? Math.max(0, metrosLineales) : 0;

  return Math.max(SUGERIDO_MINIMO_MINUTOS, redondear(estandar * metros, 1));
}

/**
 * Suggested total for the whole order: every required sector contributes its
 * own standard for the order's metres. Used by the detail hero card to flag an
 * order that is running over the plant standard.
 */
export function tiempoSugeridoOT(ot: OrdenTrabajo, sectores: Sector[]): number {
  return redondear(
    sectoresRequeridos(ot, sectores).reduce(
      (total, sector) =>
        total + tiempoSugeridoMinutos(sector.estandar_min_por_metro, ot.metros_lineales),
      0,
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* Flow rules (R6 / R8)                                                        */
/* -------------------------------------------------------------------------- */

/** Does `sector` apply to an order of line `linea`? (rule R8) */
export function sectorAplica(sector: Sector, linea: string): boolean {
  const propia = sector.linea_area || "General";
  return propia === linea || propia === "Compartido" || propia === "General";
}

function ordenarPorFlujo(linea: string) {
  return (a: Sector, b: Sector): number => {
    const propiaA = (a.linea_area || "") === linea ? 0 : 1;
    const propiaB = (b.linea_area || "") === linea ? 0 : 1;
    return propiaA - propiaB || a.orden_flujo - b.orden_flujo || a.id - b.id;
  };
}

/** Active regular sectors of a line, in flow order. */
export function sectoresDeLinea(sectores: Sector[], linea: string): Sector[] {
  return sectores
    .filter((s) => !s.clave_especial && s.activo !== false && sectorAplica(s, linea))
    .sort(ordenarPorFlujo(linea));
}

/**
 * Sectors an order must walk through: the regular flow of its line plus the
 * specialties it asked for. Inactive sectors are excluded (they must not block
 * the order).
 */
export function sectoresRequeridos(ot: OrdenTrabajo, sectores: Sector[]): Sector[] {
  const linea = ot.linea_area || "Placares";
  const requeridos = sectores.filter(
    (s) => !s.clave_especial && s.activo !== false && sectorAplica(s, linea),
  );

  for (const sector of sectores) {
    if (!sector.clave_especial || sector.activo === false) continue;
    if (!sectorAplica(sector, linea)) continue;
    if (requiereEspecial(ot, sector.clave_especial)) requeridos.push(sector);
  }

  return requeridos.sort(ordenarPorFlujo(linea));
}

/**
 * Does the order ask for a given specialty? (`requiere_vidrio`, `requiere_lustre`, ...)
 * Unknown keys always answer `false`.
 */
export function requiereEspecial(ot: OrdenTrabajo, clave: string): boolean {
  switch (clave) {
    case "vidrio":
      return ot.requiere_vidrio;
    case "lustre":
      return ot.requiere_lustre;
    case "herreria":
      return ot.requiere_herreria;
    case "especiales":
      return ot.requiere_especiales;
    default:
      return false;
  }
}

/**
 * Precedence rules (rule R6), anti-conflict:
 *  P1. Regular sectors follow the flow order of the ORDER's line.
 *  P2. A specialty requires the line's first cut to be finished.
 *  P3. Quality Control requires every specialty the order asked for.
 */
export function prerrequisitosSector(
  ot: OrdenTrabajo,
  sectorId: number,
  sectores: Sector[],
  finalizadosIds: ReadonlySet<number> | number[],
): Sector[] {
  const finalizados =
    finalizadosIds instanceof Set ? finalizadosIds : new Set<number>(finalizadosIds);

  const sector = sectores.find((s) => s.id === sectorId);
  if (!sector || finalizados.has(sectorId)) return [];

  const linea = ot.linea_area || "Placares";
  const regulares = sectoresDeLinea(sectores, linea);
  const corte = regulares.find((s) => s.linea_area === linea) ?? regulares[0];
  const faltantes = new Map<number, Sector>();

  if (sector.clave_especial) {
    if (corte && !finalizados.has(corte.id)) faltantes.set(corte.id, corte);
  } else {
    for (const previo of regulares) {
      if (previo.id === sector.id) break;
      if (!finalizados.has(previo.id)) faltantes.set(previo.id, previo);
    }
  }

  if (sector.nombre_sector === SECTOR_CONTROL) {
    for (const especial of sectores) {
      if (!especial.clave_especial) continue;
      if (!requiereEspecial(ot, especial.clave_especial)) continue;
      if (!finalizados.has(especial.id)) faltantes.set(especial.id, especial);
    }
  }

  return [...faltantes.values()];
}

/* -------------------------------------------------------------------------- */
/* Flow nodes (detail view)                                                    */
/* -------------------------------------------------------------------------- */

export type EstadoNodo = "pendiente" | "en_proceso" | "pausado" | "finalizado" | "bloqueado";

export interface NodoFlujo {
  sector: Sector;
  estado: EstadoNodo;
  /** Why the node cannot start yet (`sectores_bloqueados`), if it is blocked. */
  motivo: string | null;
}

/**
 * Turns an assembled order into the ordered nodes the detail stepper draws.
 *
 * `ot.sectores_requeridos` already carries the flow order (it comes from
 * `sectoresRequeridos`), so the only work left is classifying each sector.
 */
export function construirNodosFlujo(ot: OrdenConProgreso, sectores: Sector[]): NodoFlujo[] {
  const catalogo = new Map(sectores.map((sector) => [sector.id, sector]));
  const finalizados = new Set(ot.progreso.finalizados_ids);
  const activa = ot.etapa_activa;

  const nodos: NodoFlujo[] = [];

  for (const id of ot.sectores_requeridos) {
    const sector = catalogo.get(id);
    if (!sector) continue;

    if (finalizados.has(id)) {
      nodos.push({ sector, estado: "finalizado", motivo: null });
      continue;
    }

    if (activa && activa.sector_id === id) {
      nodos.push({
        sector,
        estado: activa.estado_etapa === "Pausado" ? "pausado" : "en_proceso",
        motivo: null,
      });
      continue;
    }

    const motivo = ot.sectores_bloqueados[id] ?? null;
    nodos.push({ sector, estado: motivo ? "bloqueado" : "pendiente", motivo });
  }

  return nodos;
}

/* -------------------------------------------------------------------------- */
/* Batch assembly (anti N+1)                                                   */
/* -------------------------------------------------------------------------- */

export interface ContextoEtapas {
  finalizados: number[];
  finalizadosSet: Set<number>;
  minutos: number;
  abierta: RegistroRow | null;
}

function tiempoRegistro(valor: string | null | undefined): number {
  if (!valor) return 0;
  const ms = new Date(valor).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Indexes every stage row by `ot_id` in a single pass.
 * O(rows) instead of one query per order.
 */
export function indexarEtapas(registros: RegistroRow[]): Map<number, ContextoEtapas> {
  const mapa = new Map<number, ContextoEtapas>();

  for (const fila of registros) {
    const otId = numero(fila.ot_id);
    let contexto = mapa.get(otId);

    if (!contexto) {
      contexto = { finalizados: [], finalizadosSet: new Set(), minutos: 0, abierta: null };
      mapa.set(otId, contexto);
    }

    if (fila.estado_etapa === "Finalizado") {
      contexto.minutos += numero(fila.duracion_minutos);
      const sectorId = numero(fila.sector_id);
      if (!contexto.finalizadosSet.has(sectorId)) {
        contexto.finalizadosSet.add(sectorId);
        contexto.finalizados.push(sectorId);
      }
      continue;
    }

    if (fila.estado_etapa === "En Proceso" || fila.estado_etapa === "Pausado") {
      // The query already sorts, but the comparison keeps the assembly
      // independent from whatever order the driver returns rows in.
      const actual = contexto.abierta;
      const nuevoInicio = tiempoRegistro(fila.fecha_hora_inicio);
      const actualInicio = actual ? tiempoRegistro(actual.fecha_hora_inicio) : -1;

      if (
        !actual ||
        nuevoInicio > actualInicio ||
        (nuevoInicio === actualInicio && numero(fila.id) > numero(actual.id))
      ) {
        contexto.abierta = fila;
      }
    }
  }

  return mapa;
}

export interface ContextoMateriales {
  materiales: MaterialOT[];
  alertas: AlertaNoConformidad[];
}

/**
 * Enriches an order with context that is already loaded. Pure: no SQL.
 * The same assembly feeds the order list and the order detail.
 */
export function construirOT(
  ot: OrdenTrabajo,
  sectores: Sector[],
  contexto: {
    etapas?: ContextoEtapas;
    materiales?: ContextoMateriales;
  } = {},
): OrdenConProgreso {
  const requeridos = sectoresRequeridos(ot, sectores);
  const idsRequeridos = new Set(requeridos.map((s) => s.id));

  const contextoEtapas: ContextoEtapas =
    contexto.etapas ?? { finalizados: [], finalizadosSet: new Set(), minutos: 0, abierta: null };

  const finalizados = new Set<number>(contextoEtapas.finalizados);
  const completados = contextoEtapas.finalizados.filter((id) => idsRequeridos.has(id)).length;

  const bloqueados: Record<number, string> = {};
  if (ot.estado_general !== "Finalizado") {
    for (const sector of requeridos) {
      if (finalizados.has(sector.id)) continue;

      const faltan = prerrequisitosSector(ot, sector.id, sectores, finalizados);
      if (faltan.length) {
        bloqueados[sector.id] = `Requiere finalizar: ${faltan
          .map((f) => f.nombre_corto || f.nombre_sector)
          .join(", ")}`;
      }
    }
  }

  const etapaActiva = contextoEtapas.abierta ? mapRegistro(contextoEtapas.abierta) : null;
  const materiales = contexto.materiales?.materiales ?? [];
  const alertas = contexto.materiales?.alertas ?? [];

  return {
    ...ot,
    sectores_requeridos: requeridos.map((s) => s.id),
    progreso: {
      sectores_requeridos: requeridos.length,
      sectores_finalizados: completados,
      porcentaje: requeridos.length ? Math.round((completados / requeridos.length) * 100) : 0,
      finalizados_ids: contextoEtapas.finalizados,
    },
    minutos_acumulados: redondear(contextoEtapas.minutos),
    etapa_activa: etapaActiva,
    sectores_bloqueados: bloqueados,
    sector_actual: etapaActiva
      ? {
          id: etapaActiva.sector_id,
          sector_id: etapaActiva.sector_id,
          nombre_sector: etapaActiva.nombre_sector ?? null,
          nombre_corto: etapaActiva.nombre_corto ?? null,
          estado_etapa: etapaActiva.estado_etapa,
          fecha_hora_inicio: etapaActiva.fecha_hora_inicio,
        }
      : null,
    etapas_completadas: contextoEtapas.finalizados,
    total_etapas_completadas: contextoEtapas.finalizados.length,
    materiales,
    resumen_materiales: resumenMateriales(materiales),
    alertas,
    alertas_abiertas: alertas.filter((a) => a.estado === "Pendiente" || a.estado === "En Reproceso")
      .length,
  };
}
