import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import GraficoMetros from "@/components/dashboard/GraficoMetros";
import GraficoTiempos from "@/components/dashboard/GraficoTiempos";
import { fechaLocal, minutosLegibles } from "@/lib/produccion";
import { calcularMetricas, type MetricasDashboard } from "@/lib/metricas-db";
import { sesionActual } from "@/lib/session-server";

/*
 * Analytics dashboard.
 *
 * Server Component: every number is aggregated in `calcularMetricas` (five
 * round trips, no client-side fetching). The only client islands are the two
 * Recharts components, which receive their series as props.
 */

export const metadata: Metadata = {
  title: "Dashboard — OptiFlow",
};

const ENTERO = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

/** Lead time in the unit the plant reads first: days when it crosses one. */
function leadTimeLegible(minutos: number | null): string {
  if (minutos === null) return "—";
  if (minutos >= 1440) return `${(minutos / 1440).toFixed(1)} d`;
  return `${(minutos / 60).toFixed(1)} h`;
}

function Kpi({
  etiqueta,
  valor,
  detalle,
  tono,
  nota,
}: {
  etiqueta: string;
  valor: string;
  detalle: string;
  tono: string;
  nota?: string;
}) {
  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">
        {etiqueta}
      </p>
      <p className={`mt-2 font-mono text-3xl font-semibold tabular-nums ${tono}`}>{valor}</p>
      <p className="mt-1 text-xs leading-relaxed text-white/45">{detalle}</p>
      {nota ? (
        <p className="mt-2 border-t border-border/60 pt-2 font-mono text-[10px] leading-relaxed text-white/30">
          {nota}
        </p>
      ) : null}
    </article>
  );
}

function Panel({
  titulo,
  descripcion,
  children,
  className = "",
}: {
  titulo: string;
  descripcion: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex flex-col gap-3 rounded-xl border border-border bg-card p-4 ${className}`}>
      <header>
        <h2 className="text-sm font-semibold tracking-tight">{titulo}</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-white/40">{descripcion}</p>
      </header>
      {children}
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="h-32 animate-pulse rounded-xl bg-card" />
        <div className="h-32 animate-pulse rounded-xl bg-card" />
        <div className="h-32 animate-pulse rounded-xl bg-card" />
        <div className="h-32 animate-pulse rounded-xl bg-card" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="h-[360px] animate-pulse rounded-xl bg-card" />
        <div className="h-[360px] animate-pulse rounded-xl bg-card" />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Data-dependent section (inside Suspense)                                    */
/* -------------------------------------------------------------------------- */

function Kpis({ metricas }: { metricas: MetricasDashboard }) {
  const { lead_time: leadTime, standby, ftt, metros } = metricas;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi
        etiqueta="Lead time promedio"
        valor={leadTimeLegible(leadTime.promedio_minutos)}
        detalle={
          leadTime.promedio_minutos === null
            ? "Sin órdenes cerradas en el período."
            : `${minutosLegibles(leadTime.promedio_minutos)} de punta a punta`
        }
        tono="text-cian"
        nota={`${leadTime.ots_medidas} OT medida(s) · sólo órdenes cerradas`}
      />
      <Kpi
        etiqueta="Tiempo standby"
        valor={standby.promedio_minutos === null ? "—" : `${(standby.promedio_minutos / 60).toFixed(1)} h`}
        detalle={
          standby.promedio_minutos === null
            ? "Sin traspasos entre sectores."
            : `Muerto por OT entre sectores (${minutosLegibles(standby.promedio_minutos)})`
        }
        tono="text-pausa"
        nota={`${standby.traspasos} traspaso(s) en ${standby.ots_con_traspaso} OT · tope 24 h`}
      />
      <Kpi
        etiqueta="Índice FTT"
        valor={ftt.porcentaje === null ? "—" : `${ftt.porcentaje.toFixed(1)} %`}
        detalle={
          ftt.porcentaje === null
            ? "Sin OT avanzadas en el período."
            : `${ftt.conformes} de ${ftt.evaluadas} OT sin reproceso`
        }
        tono="text-proceso"
        nota={`Reproceso: ${ftt.motivos.join(" · ")}`}
      />
      <Kpi
        etiqueta="Metros del mes"
        valor={`${ENTERO.format(metros.total)} m`}
        detalle={`Meta ${ENTERO.format(metros.meta_total)} m · ${
          metros.porcentaje === null ? "sin meta" : `${metros.porcentaje.toFixed(1)} %`
        }`}
        tono="text-placares"
        nota={metros.meta_configurada ? `Objetivo ${metros.periodo} configurado` : `Objetivo ${metros.periodo} por defecto`}
      />
    </div>
  );
}

async function Tablero() {
  if (!(await sesionActual())) redirect("/login");

  const metricas = await calcularMetricas();

  return (
    <div className="flex flex-col gap-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/30">
        Ventana {fechaLocal(metricas.periodo.desde)} — {fechaLocal(metricas.periodo.hasta)} ·{" "}
        {metricas.periodo.dias} días
      </p>

      <Kpis metricas={metricas} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel
          titulo="Horas consumidas por sector"
          descripcion="Etapas cerradas en la ventana, sin contar pausas. Placares en azul, cocinas en rojo, sectores compartidos en cian."
        >
          <GraficoTiempos datos={metricas.horas_por_sector} />
        </Panel>

        <Panel
          titulo="Metros lineales del mes"
          descripcion="Acumulado real contra el ritmo ideal de la meta mensual de corte."
        >
          <GraficoMetros metros={metricas.metros} />
        </Panel>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-white/50">
          Analítica de producción: lead time, standby, calidad a la primera y cumplimiento
          de la meta de corte.
        </p>
      </header>

      <Suspense fallback={<DashboardSkeleton />}>
        <Tablero />
      </Suspense>
    </div>
  );
}
