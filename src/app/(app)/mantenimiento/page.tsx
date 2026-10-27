import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import PanelMaquinas from "@/components/mantenimiento/PanelMaquinas";
import { listarMantenimiento } from "@/lib/mantenimiento-db";
import { fechaHoraLocal } from "@/lib/produccion";
import { listarSectores } from "@/lib/produccion-db";
import { sesionActual } from "@/lib/session-server";

/*
 * Preventive maintenance panel (TPM).
 *
 * Server Component: hours, percentages and states are computed in the data
 * layer with the plant's business rules. The client island only owns the
 * dialogs (service + machine form); the table of history is server-rendered.
 */

export const metadata: Metadata = {
  title: "Mantenimiento — OptiFlow",
};

const ENTERO = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

function Kpi({
  etiqueta,
  valor,
  detalle,
  tono,
}: {
  etiqueta: string;
  valor: string;
  detalle: string;
  tono: string;
}) {
  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">
        {etiqueta}
      </p>
      <p className={`mt-2 font-mono text-3xl font-semibold tabular-nums ${tono}`}>{valor}</p>
      <p className="mt-1 text-xs leading-relaxed text-white/45">{detalle}</p>
    </article>
  );
}

function MantenimientoSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="h-32 animate-pulse rounded-xl bg-card" />
        <div className="h-32 animate-pulse rounded-xl bg-card" />
        <div className="h-32 animate-pulse rounded-xl bg-card" />
        <div className="h-32 animate-pulse rounded-xl bg-card" />
      </div>
      <div className="h-72 animate-pulse rounded-xl bg-card" />
      <div className="h-56 animate-pulse rounded-xl bg-card" />
    </div>
  );
}

async function PanelMantenimiento() {
  if (!(await sesionActual())) redirect("/login");

  const [listado, sectores] = await Promise.all([
    listarMantenimiento(),
    listarSectores(false),
  ]);

  const { resumen, maquinas, historial } = listado;

  return (
    <div className="flex flex-col gap-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/30">
        {resumen.total} máquina(s) · {resumen.inactivas} inactiva(s) · umbrales 80 % / 100 %
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          etiqueta="Máquinas"
          valor={ENTERO.format(resumen.total)}
          detalle={`${resumen.inactivas} inactiva(s) fuera del aviso de terminal`}
          tono="text-cian"
        />
        <Kpi
          etiqueta="Al día"
          valor={ENTERO.format(resumen.ok)}
          detalle="Uso menor al 80 % del intervalo."
          tono="text-proceso"
        />
        <Kpi
          etiqueta="Advertencia"
          valor={ENTERO.format(resumen.advertencia)}
          detalle="Entre 80 % y 99 %: programar el service."
          tono="text-pausa"
        />
        <Kpi
          etiqueta="Críticas"
          valor={ENTERO.format(resumen.critico)}
          detalle="100 % o más: mantenimiento vencido."
          tono={resumen.critico > 0 ? "text-alerta" : "text-white/60"}
        />
      </div>

      <PanelMaquinas maquinas={maquinas} sectores={sectores} />

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <header>
          <h2 className="text-sm font-semibold tracking-tight">Historial de services</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-white/40">
            Últimos 500 registros. La columna de horas es la foto del acumulado del
            sector al momento del service, no un contador que se reinicia.
          </p>
        </header>

        {historial.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-white/35">
            Todavía no hay services registrados.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-[0.12em] text-white/35">
                  <th className="px-3 py-2 font-medium">Fecha</th>
                  <th className="px-3 py-2 font-medium">Máquina</th>
                  <th className="px-3 py-2 font-medium">Sector</th>
                  <th className="px-3 py-2 font-medium">Técnico</th>
                  <th className="px-3 py-2 text-right font-medium">Horas</th>
                  <th className="px-3 py-2 font-medium">Observaciones</th>
                </tr>
              </thead>
              <tbody>
                {historial.map((fila) => (
                  <tr
                    key={fila.id}
                    className="border-b border-border/60 last:border-0 hover:bg-white/[0.03]"
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-white/50">
                      {fechaHoraLocal(fila.fecha_hora)}
                    </td>
                    <td className="px-3 py-2">
                      <span className="block text-white/85">{fila.nombre_maquina}</span>
                      <span className="block text-[10px] text-white/30">
                        {fila.tarea_mantenimiento}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-white/50">
                      {fila.nombre_sector}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-white/60">
                      {fila.tecnico_operario}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs tabular-nums text-cian">
                      {fila.horas_acumuladas_al_service.toFixed(2)} h
                    </td>
                    <td className="max-w-[280px] px-3 py-2 text-xs leading-relaxed text-white/45">
                      {fila.observaciones ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function MantenimientoPage() {
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Mantenimiento</h1>
        <p className="text-sm text-white/50">
          TPM por horas netas de uso: el contador corre con las etapas finalizadas
          del sector, nunca con el calendario.
        </p>
      </header>

      <Suspense fallback={<MantenimientoSkeleton />}>
        <PanelMantenimiento />
      </Suspense>
    </div>
  );
}
