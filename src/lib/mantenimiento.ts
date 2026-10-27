/*
 * Preventive maintenance (TPM) domain: pure calculations and types.
 *
 * The counter is NOT a machine counter: it is the NET worked hours of the
 * whole sector (only `Finalizado` stages, so pauses do not advance it) minus
 * the snapshot taken when the last service was registered. Keeping the
 * arithmetic here, outside the SQL module, is what lets the terminal banner
 * and the admin table show the exact same number.
 */

export const ESTADOS_TPM = ["ok", "advertencia", "critico"] as const;
export type EstadoTPM = (typeof ESTADOS_TPM)[number];

/** T2 thresholds. Centralised so API and UI cannot drift. */
export const UMBRAL_ADVERTENCIA = 80;
export const UMBRAL_CRITICO = 100;

export function estadoDeUso(pct: number): EstadoTPM {
  if (pct >= UMBRAL_CRITICO) return "critico";
  if (pct >= UMBRAL_ADVERTENCIA) return "advertencia";
  return "ok";
}

export interface MaquinaTPM {
  id: number;
  sector_id: number;
  nombre_sector: string | null;
  linea_area: string | null;
  nombre_maquina: string;
  tarea_mantenimiento: string;
  intervalo_horas_target: number;
  horas_acumuladas_sector: number;
  horas_ultimo_mantenimiento: number;
  horas_desde_ultimo_mantenimiento: number;
  horas_restantes: number;
  pct_uso: number;
  estado: EstadoTPM;
  activo: boolean;
}

export interface MaquinaTPMRow {
  id: number;
  sector_id: number;
  nombre_sector: string | null;
  linea_area: string | null;
  nombre_maquina: string;
  tarea_mantenimiento: string;
  intervalo_horas_target: number | string;
  horas_ultimo_mantenimiento: number | string | null;
  activo: number | string | boolean;
}

export interface HistorialMantenimiento {
  id: number;
  maquina_tpm_id: number;
  nombre_maquina: string | null;
  tarea_mantenimiento: string | null;
  nombre_sector: string | null;
  tecnico_operario: string;
  fecha_hora: string;
  horas_acumuladas_al_service: number;
  observaciones: string | null;
}

export interface ResumenTPM {
  total: number;
  ok: number;
  advertencia: number;
  critico: number;
  inactivas: number;
}

/** Service registration payload (T3). */
export interface EntradaService {
  maquina_tpm_id: number;
  tecnico_operario: string;
  observaciones?: string;
}

/** Machine create/edit payload; omitted optional fields keep their value. */
export interface EntradaMaquina {
  id?: number;
  sector_id: number;
  nombre_maquina: string;
  tarea_mantenimiento: string;
  intervalo_horas_target: number;
  horas_ultimo_mantenimiento?: number;
  activo?: boolean;
}

/** Rounds to 2 decimals, the same precision the legacy API published. */
export function r2(valor: number): number {
  return Math.round(Number(valor || 0) * 100) / 100;
}

/** Enriches a `maquinas_tpm` row with the live hours of its sector. */
export function computarMaquina(row: MaquinaTPMRow, horasSector: number): MaquinaTPM {
  const base = Number(row.horas_ultimo_mantenimiento || 0);
  const objetivo = Number(row.intervalo_horas_target || 0);

  const desdeServicio = Math.max(0, horasSector - base);
  const pct = objetivo > 0 ? (desdeServicio / objetivo) * 100 : 0;

  return {
    id: Number(row.id),
    sector_id: Number(row.sector_id),
    nombre_sector: row.nombre_sector ?? null,
    linea_area: row.linea_area ?? null,
    nombre_maquina: String(row.nombre_maquina ?? ""),
    tarea_mantenimiento: String(row.tarea_mantenimiento ?? ""),
    intervalo_horas_target: objetivo,
    horas_acumuladas_sector: r2(horasSector),
    horas_ultimo_mantenimiento: r2(base),
    horas_desde_ultimo_mantenimiento: r2(desdeServicio),
    horas_restantes: r2(Math.max(0, objetivo - desdeServicio)),
    pct_uso: r2(pct),
    estado: estadoDeUso(pct),
    activo:
      row.activo === true || row.activo === 1 || row.activo === "1" || row.activo === "t",
  };
}
