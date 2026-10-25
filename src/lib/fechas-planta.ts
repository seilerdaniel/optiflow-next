import { ZONA_PLANTA } from "@/lib/produccion";

/*
 * Local date windows for the plant timezone.
 *
 * The runtime is UTC (Vercel) and the factory runs in `America/Argentina/...`,
 * so every "today", "this month" or "last 30 days" boundary has to be built
 * here instead of relying on SQL's `now()` or on the server clock's timezone.
 *
 * The legacy backend kept the same helpers in `server/db.js`; the algorithm is
 * identical (the local wall clock read as if it were UTC, minus the real
 * instant, gives the offset), because Argentina has no DST and a single offset
 * per process is exact.
 */

const FECHA_HORA_PLANTA = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_PLANTA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** `2026-10-25 14:35:02` — the plant wall clock for an instant. */
function legiblePlanta(instanteMs: number): string {
  const partes = FECHA_HORA_PLANTA.formatToParts(new Date(instanteMs));
  const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((parte) => parte.type === tipo)?.value ?? "";

  return `${valor("year")}-${valor("month")}-${valor("day")} ${valor("hour")}:${valor(
    "minute",
  )}:${valor("second")}`;
}

/** Difference between the plant wall clock and UTC, in milliseconds. */
function offsetPlantaMs(instanteMs: number): number {
  return Date.parse(`${legiblePlanta(instanteMs).replace(" ", "T")}Z`) - instanteMs;
}

/** `YYYY-MM-DD` of an ISO instant, in plant time. */
export function diaLocal(iso: string): string {
  const instante = Date.parse(iso);
  if (!Number.isFinite(instante)) return "";
  return legiblePlanta(instante).slice(0, 10);
}

/** `YYYY-MM-DD` of today in the plant. */
export function hoyLocal(): string {
  return legiblePlanta(Date.now()).slice(0, 10);
}

/** `YYYY-MM` of the current month in the plant. */
export function periodoActual(): string {
  return hoyLocal().slice(0, 7);
}

/** Adds `dias` to a `YYYY-MM-DD` string without touching the system clock. */
export function correrDias(fechaLocal: string, dias: number): string {
  const ms = Date.parse(`${fechaLocal}T12:00:00Z`) + dias * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** ISO UTC instant of the plant midnight that opens `fechaLocal`. */
export function inicioDiaLocalUTC(fechaLocal: string): string {
  const offset = offsetPlantaMs(Date.now());
  return new Date(Date.parse(`${fechaLocal}T00:00:00Z`) - offset).toISOString();
}

/**
 * `[desdeUTC, hastaUTC)`: the full plant day range from `desde` to `hasta`
 * inclusive, already translated to instants so it can be compared against the
 * ISO-8601 text columns without depending on the runtime timezone.
 */
export function ventanaLocalUTC(desdeLocal: string, hastaLocal: string): [string, string] {
  return [
    inicioDiaLocalUTC(desdeLocal),
    inicioDiaLocalUTC(correrDias(hastaLocal, 1)),
  ];
}

/** `YYYY-MM-DD` of the first day of the month after `periodo` (`YYYY-MM`). */
export function inicioMesSiguiente(periodo: string): string {
  const anio = Number(periodo.slice(0, 4));
  const mes = Number(periodo.slice(5, 7));
  return mes === 12
    ? `${anio + 1}-01-01`
    : `${anio}-${String(mes + 1).padStart(2, "0")}-01`;
}

/** Whole days from `desde` to `hasta`, excluding `hasta` itself. */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round(
    (Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000,
  );
}

/** `dd/mm` label for a `YYYY-MM-DD` day, used by the chart axes. */
export function etiquetaDia(fechaLocal: string): string {
  const [, mes, dia] = fechaLocal.split("-");
  return `${dia}/${mes}`;
}
