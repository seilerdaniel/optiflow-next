/*
 * Quality domain (QMS): catalogs, types and mappers.
 *
 * Pure module: no `pg`, no HTTP, no Node-only imports. The admin page, the
 * terminal dialog and the route handlers all read the same catalogs from here,
 * so the UI and the API can never offer different options.
 */

export const TIPOS_FALLA_QMS = [
  "Rotura de placa / Astillado",
  "Error de veta",
  "Defecto de laca / Lustre",
  "Falla de mecanizado / Cota",
  "Error de plano",
  "Otro",
] as const;

export type TipoFallaQMS = (typeof TIPOS_FALLA_QMS)[number];

export const ESTADOS_QMS = ["Pendiente", "En Reproceso", "Resuelto", "Descartado"] as const;

export type EstadoQMS = (typeof ESTADOS_QMS)[number];

/** States that still need somebody to do something about the failure. */
export const ESTADOS_QMS_ABIERTOS = ["Pendiente", "En Reproceso"] as const;

/**
 * Pause reason that best represents each QMS failure.
 *
 * The stage is paused with a reason from `MOTIVOS_PAUSA`, a shorter catalog that
 * predates QMS. Mapping here (instead of letting the client send a pause reason)
 * keeps the two catalogs from drifting: a new failure type forces a decision
 * about which pause it produces.
 */
export function motivoPausaDe(tipoFalla: TipoFallaQMS): string {
  if (tipoFalla === "Rotura de placa / Astillado") return "Rotura de placa";
  if (tipoFalla === "Error de plano") return "Error de plano";
  if (tipoFalla === "Falla de mecanizado / Cota") return "Ajuste de herramienta";
  return "Otro";
}

export interface NoConformidad {
  id: number;
  ot_id: number;
  sector_id: number;
  numero_ot: string;
  cliente: string;
  linea_area: string;
  nombre_sector: string;
  operario_responsable: string | null;
  encargado_reporta: string;
  tipo_falla: TipoFallaQMS;
  observacion: string | null;
  foto_url: string | null;
  estado: EstadoQMS;
  accion_correctiva: string | null;
  resuelto_por: string | null;
  fecha_resolucion: string | null;
  fecha_registro: string;
  fecha_actualizacion: string;
}

/** What `pg` returns for the joined row (`timestamptz` arrives as `Date`). */
export interface NoConformidadRow {
  id: number;
  ot_id: number;
  sector_id: number;
  numero_ot: string;
  cliente: string;
  linea_area: string;
  nombre_sector: string;
  operario_responsable: string | null;
  encargado_reporta: string;
  tipo_falla: string;
  observacion: string | null;
  foto_url: string | null;
  estado: string;
  accion_correctiva: string | null;
  resuelto_por: string | null;
  fecha_resolucion: Date | string | null;
  fecha_registro: Date | string;
  fecha_actualizacion: Date | string;
}

/** `Date | string | null` → ISO string. `timestamptz` is parsed to `Date`. */
export function instanteIso(valor: Date | string | null | undefined): string | null {
  if (!valor) return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor.toISOString();
  return valor;
}

export function mapNoConformidad(row: NoConformidadRow): NoConformidad {
  return {
    id: Number(row.id),
    ot_id: Number(row.ot_id),
    sector_id: Number(row.sector_id),
    numero_ot: String(row.numero_ot ?? ""),
    cliente: String(row.cliente ?? ""),
    linea_area: String(row.linea_area ?? ""),
    nombre_sector: String(row.nombre_sector ?? ""),
    operario_responsable: row.operario_responsable ?? null,
    encargado_reporta: String(row.encargado_reporta ?? ""),
    tipo_falla: row.tipo_falla as TipoFallaQMS,
    observacion: row.observacion ?? null,
    foto_url: row.foto_url ?? null,
    estado: row.estado as EstadoQMS,
    accion_correctiva: row.accion_correctiva ?? null,
    resuelto_por: row.resuelto_por ?? null,
    fecha_resolucion: instanteIso(row.fecha_resolucion),
    fecha_registro: instanteIso(row.fecha_registro) ?? "",
    fecha_actualizacion: instanteIso(row.fecha_actualizacion) ?? "",
  };
}

export interface ResumenCalidad {
  periodo: string;
  desde: string;
  hasta: string;
  total_mes: number;
  pendientes: number;
  en_reproceso: number;
  resueltas_mes: number;
  descartadas_mes: number;
  /** Open failures registered inside the window. */
  abiertas: number;
  /** Open failures regardless of date: the real backlog of the plant. */
  abiertas_totales: number;
  por_tipo: Array<{ tipo_falla: string; cantidad: number }>;
  tipo_mas_recurrente: { tipo_falla: string; cantidad: number } | null;
  /**
   * Quality FTT: orders that closed at least one stage this month and have no
   * open (non-discarded) non-conformity. It is NOT the dashboard FTT, which
   * counts reproceso pauses at stage level. Two different questions.
   */
  ftt: {
    evaluadas: number;
    conformes: number;
    porcentaje: number | null;
  };
}

export interface FiltrosCalidad {
  ot_id?: number;
  sector_id?: number;
  estado?: EstadoQMS;
  tipo_falla?: TipoFallaQMS;
  desde?: string;
  hasta?: string;
  periodo?: string;
  limite: number;
}
