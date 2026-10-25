import Link from "next/link";
import {
  fechaLocal,
  formatearDuracion,
  minutosLegibles,
  type OrdenConProgreso,
} from "@/lib/produccion";
import { ESTADO_OT_BADGE, ESTADO_OT_PUNTO, LINEA_BADGE, LINEA_PUNTO } from "./ui";

/*
 * Executive header of an order: identity on the left, four KPIs plus the
 * progress rail in the middle, and the printable route-sheet QR on the right.
 *
 * The accumulated time turns red as soon as it passes the plant standard
 * (`tiempoSugeridoOT`), which is the only signal the office needs to know an
 * order is drifting before it misses its promised date.
 */

export default function HeroCardOT({
  ot,
  qrSrc,
  tiempoSugerido,
}: {
  ot: OrdenConProgreso;
  qrSrc: string;
  tiempoSugerido: number;
}) {
  const excedido = tiempoSugerido > 0 && ot.minutos_acumulados > tiempoSugerido;
  const desvio =
    tiempoSugerido > 0 ? Math.round((ot.minutos_acumulados / tiempoSugerido) * 100) : null;

  return (
    <section className="rounded-xl border border-border bg-card p-4 md:p-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.55fr)_auto] lg:items-center">
        {/* Identity */}
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] ${LINEA_BADGE[ot.linea_area]}`}
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${LINEA_PUNTO[ot.linea_area]}`}
              />
              {ot.linea_area}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] ${ESTADO_OT_BADGE[ot.estado_general]}`}
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${ESTADO_OT_PUNTO[ot.estado_general]}`}
              />
              {ot.estado_general}
            </span>
            {ot.alertas_abiertas > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-alerta/50 bg-alerta/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-alerta">
                {ot.alertas_abiertas} NC
              </span>
            ) : null}
          </div>

          <h1 className="truncate font-mono text-xl font-semibold tracking-tight md:text-2xl">
            {ot.numero_ot}
          </h1>

          <p className="text-sm font-medium text-white/90">{ot.cliente}</p>
          <p className="truncate text-xs text-white/45">
            {ot.modelo ? ot.modelo : "Sin modelo informado"}
          </p>
        </div>

        {/* KPIs + progress */}
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <div className="rounded-lg border border-border/70 bg-industrial/60 p-3">
              <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">
                Metros lineales
              </dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
                {ot.metros_lineales.toFixed(1)}
                <span className="ml-1 text-xs font-normal text-white/40">m</span>
              </dd>
            </div>

            <div className="rounded-lg border border-border/70 bg-industrial/60 p-3">
              <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">
                Fecha prometida
              </dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
                {fechaLocal(ot.fecha_prometida)}
              </dd>
            </div>

            <div className="rounded-lg border border-border/70 bg-industrial/60 p-3">
              <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">
                Sectores
              </dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
                {ot.progreso.sectores_finalizados}
                <span className="text-sm font-normal text-white/40">
                  /{ot.progreso.sectores_requeridos}
                </span>
              </dd>
            </div>

            <div
              className={`rounded-lg border p-3 ${
                excedido
                  ? "border-alerta/60 bg-alerta/10"
                  : "border-border/70 bg-industrial/60"
              }`}
            >
              <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">
                Tiempo acumulado
              </dt>
              <dd
                className={`mt-1 font-mono text-lg font-semibold tabular-nums ${
                  excedido ? "text-alerta" : ""
                }`}
              >
                {formatearDuracion(ot.minutos_acumulados)}
              </dd>
              <dd className="mt-0.5 text-[10px] text-white/40">
                {excedido ? (
                  <span className="font-semibold text-alerta">
                    Excedido · {desvio}% del estándar
                  </span>
                ) : (
                  <>Est. {minutosLegibles(tiempoSugerido)}</>
                )}
              </dd>
            </div>
          </dl>

          <div className="flex items-center gap-2">
            <div
              className="h-2 flex-1 overflow-hidden rounded-full bg-industrial"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={ot.progreso.porcentaje}
              aria-label="Progreso de la orden"
            >
              <div
                className={`h-full rounded-full transition-[width] ${
                  ot.progreso.porcentaje >= 100 ? "bg-cian" : "bg-proceso"
                }`}
                style={{ width: `${ot.progreso.porcentaje}%` }}
              />
            </div>
            <span className="w-14 shrink-0 text-right font-mono text-[11px] tabular-nums text-white/50">
              {ot.progreso.porcentaje}%
            </span>
          </div>
        </div>

        {/* Route-sheet QR */}
        <div className="flex flex-col items-center gap-2 lg:border-l lg:border-border lg:pl-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrSrc}
            alt={`QR de la ${ot.numero_ot}`}
            width={150}
            height={150}
            className="h-[150px] w-[150px] rounded-md bg-white p-1"
          />
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">
            Hoja de ruta
          </p>
          <Link
            href={`/?ot=${encodeURIComponent(ot.numero_ot)}`}
            className="text-[11px] text-cian underline-offset-2 hover:underline"
          >
            Abrir en terminal
          </Link>
        </div>
      </div>
    </section>
  );
}
