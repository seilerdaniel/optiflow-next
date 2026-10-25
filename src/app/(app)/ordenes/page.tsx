import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import BotonNuevaOT from "@/components/ordenes/BotonNuevaOT";
import {
  ESTADO_OT_BADGE,
  ESTADO_OT_PUNTO,
  LINEA_BADGE,
  LINEA_PUNTO,
} from "@/components/ordenes/ui";
import {
  fechaLocal,
  formatearDuracion,
  type EstadoOT,
  type LineaOT,
  type OrdenConProgreso,
} from "@/lib/produccion";
import { listarOrdenes } from "@/lib/produccion-db";
import { sesionActual } from "@/lib/session-server";

/*
 * Order list (office technical department).
 *
 * A Server Component: the rows arrive already assembled by `listarOrdenes`, the
 * anti-N+1 batch (three round trips for the whole list). Only two pieces are
 * client-side: the "+ Nueva OT" modal and a couple of plain links.
 *
 * Responsive contract: table from `md` up, stacked cards on phones.
 */

export const metadata: Metadata = {
  title: "Órdenes — OptiFlow",
};

type Parametros = Promise<Record<string, string | string[] | undefined>>;

/* -------------------------------------------------------------------------- */
/* Small presentational pieces                                                 */
/* -------------------------------------------------------------------------- */

function BadgeLinea({ linea }: { linea: LineaOT }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] ${LINEA_BADGE[linea]}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${LINEA_PUNTO[linea]}`} />
      {linea}
    </span>
  );
}

function BadgeEstado({ estado }: { estado: EstadoOT }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] ${ESTADO_OT_BADGE[estado]}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${ESTADO_OT_PUNTO[estado]}`} />
      {estado}
    </span>
  );
}

function BarraProgreso({ ot }: { ot: OrdenConProgreso }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-24 overflow-hidden rounded-full bg-industrial"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={ot.progreso.porcentaje}
        aria-label={`Progreso de la ${ot.numero_ot}`}
      >
        <div
          className={`h-full rounded-full ${ot.progreso.porcentaje >= 100 ? "bg-cian" : "bg-proceso"}`}
          style={{ width: `${ot.progreso.porcentaje}%` }}
        />
      </div>
      <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-white/50">
        {ot.progreso.sectores_finalizados}/{ot.progreso.sectores_requeridos}
      </span>
      <span className="font-mono text-[10px] tabular-nums text-white/30">
        {ot.progreso.porcentaje}%
      </span>
    </div>
  );
}

function Metrica({ etiqueta, valor, tono }: { etiqueta: string; valor: number; tono: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">{etiqueta}</p>
      <p className={`mt-1 font-mono text-lg font-semibold tabular-nums ${tono}`}>{valor}</p>
    </div>
  );
}

function ToggleLink({
  href,
  activo,
  children,
}: {
  href: string;
  activo: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={activo ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        activo ? "bg-industrial text-white ring-1 ring-cian/40" : "text-white/50 hover:text-white"
      }`}
    >
      {children}
    </Link>
  );
}

function ListaSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      <div className="h-16 animate-pulse rounded-lg bg-card" />
      <div className="h-12 animate-pulse rounded-lg bg-card" />
      <div className="h-12 animate-pulse rounded-lg bg-card" />
      <div className="h-12 animate-pulse rounded-lg bg-card" />
      <div className="h-12 animate-pulse rounded-lg bg-card" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Data-dependent section (inside Suspense)                                    */
/* -------------------------------------------------------------------------- */

async function Lista({ searchParams }: { searchParams: Parametros }) {
  if (!(await sesionActual())) redirect("/login");

  const parametros = await searchParams;
  const todas = parametros.todas === "1" || parametros.todas === "true";

  const ordenes = await listarOrdenes({ todos: todas });

  const enProduccion = ordenes.filter((ot) => ot.estado_general === "En Producción").length;
  const detenidas = ordenes.filter((ot) => ot.estado_general === "Detenido").length;
  const alertas = ordenes.reduce((total, ot) => total + ot.alertas_abiertas, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          <ToggleLink href="/ordenes" activo={!todas}>
            Activas
          </ToggleLink>
          <ToggleLink href="/ordenes?todas=1" activo={todas}>
            Todas
          </ToggleLink>
        </div>
        <p className="font-mono text-[11px] tabular-nums text-white/35">
          {ordenes.length} orden(es)
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metrica etiqueta="En listado" valor={ordenes.length} tono="text-white" />
        <Metrica etiqueta="En producción" valor={enProduccion} tono="text-proceso" />
        <Metrica etiqueta="Detenidas" valor={detenidas} tono="text-pausa" />
        <Metrica etiqueta="NC abiertas" valor={alertas} tono="text-alerta" />
      </div>

      {ordenes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/40 px-4 py-10 text-center">
          <p className="text-sm text-white/60">
            {todas ? "No hay órdenes cargadas en el sistema." : "No hay órdenes activas."}
          </p>
          <p className="mt-1 text-xs text-white/35">
            {todas
              ? "Cree la primera OT con el botón «+ Nueva OT»."
              : "Use «Todas» para ver las órdenes finalizadas o cree una nueva OT."}
          </p>
        </div>
      ) : (
        <>
          {/* Phones: cards */}
          <ul className="flex flex-col gap-2 md:hidden">
            {ordenes.map((ot) => (
              <li key={ot.id}>
                <Link
                  href={`/ordenes/${ot.id}`}
                  className="block rounded-lg border border-border bg-card p-4 transition-colors active:bg-white/5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-base font-semibold text-cian">
                      {ot.numero_ot}
                    </span>
                    <BadgeEstado estado={ot.estado_general} />
                  </div>

                  <p className="mt-2 truncate text-sm font-medium">{ot.cliente}</p>
                  <p className="truncate text-xs text-white/40">
                    {ot.modelo ?? "Sin modelo informado"}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <BadgeLinea linea={ot.linea_area} />
                    <span className="font-mono text-[10px] text-white/35">
                      Prom. {fechaLocal(ot.fecha_prometida)}
                    </span>
                    {ot.alertas_abiertas > 0 ? (
                      <span className="rounded-full border border-alerta/50 bg-alerta/15 px-2 py-0.5 font-mono text-[10px] text-alerta">
                        {ot.alertas_abiertas} NC
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3">
                    <BarraProgreso ot={ot} />
                  </div>

                  <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-white/35">
                    <span>{formatearDuracion(ot.minutos_acumulados)} acumulado</span>
                    <span className="text-cian">Ver detalle →</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/* Tablets and up: table */}
          <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-industrial/50 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">
                  <th scope="col" className="px-4 py-3">N° OT</th>
                  <th scope="col" className="px-4 py-3">Cliente</th>
                  <th scope="col" className="px-4 py-3">Línea</th>
                  <th scope="col" className="px-4 py-3">Progreso</th>
                  <th scope="col" className="hidden px-4 py-3 lg:table-cell">
                    Fecha prometida
                  </th>
                  <th scope="col" className="px-4 py-3">Estado</th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Abrir</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ordenes.map((ot) => (
                  <tr
                    key={ot.id}
                    className="border-b border-border/60 last:border-0 hover:bg-white/[0.03]"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/ordenes/${ot.id}`}
                        className="font-mono text-sm font-semibold text-cian underline-offset-2 hover:underline"
                      >
                        {ot.numero_ot}
                      </Link>
                      {ot.alertas_abiertas > 0 ? (
                        <span className="ml-2 rounded-full border border-alerta/50 bg-alerta/15 px-1.5 py-0.5 font-mono text-[9px] text-alerta">
                          {ot.alertas_abiertas} NC
                        </span>
                      ) : null}
                    </td>
                    <td className="max-w-[280px] px-4 py-3">
                      <span className="block truncate">{ot.cliente}</span>
                      <span className="block truncate text-xs text-white/35">
                        {ot.modelo ?? "Sin modelo"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <BadgeLinea linea={ot.linea_area} />
                    </td>
                    <td className="px-4 py-3">
                      <BarraProgreso ot={ot} />
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-3 font-mono text-xs tabular-nums text-white/60 lg:table-cell">
                      {fechaLocal(ot.fecha_prometida)}
                    </td>
                    <td className="px-4 py-3">
                      <BadgeEstado estado={ot.estado_general} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/ordenes/${ot.id}`}
                        aria-label={`Abrir la ${ot.numero_ot}`}
                        className="font-mono text-sm text-white/35 transition-colors hover:text-cian"
                      >
                        →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default function OrdenesPage({ searchParams }: { searchParams: Parametros }) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Órdenes de Trabajo</h1>
          <p className="text-sm text-white/50">
            Seguimiento de OT por línea, progreso de sectores y estado general.
          </p>
        </div>
        <BotonNuevaOT />
      </header>

      <Suspense fallback={<ListaSkeleton />}>
        <Lista searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
