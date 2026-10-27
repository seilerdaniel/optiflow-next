import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import BotonResolver from "@/components/calidad/BotonResolver";
import { listarNoConformidades, type ListadoCalidad } from "@/lib/calidad-db";
import type { EstadoQMS, NoConformidad } from "@/lib/calidad";
import { fechaHoraLocal } from "@/lib/produccion";
import { sesionActual } from "@/lib/session-server";

/*
 * Quality panel (QMS).
 *
 * Server Component: the list and every KPI come from a single `listar...` call.
 * The only client island is the resolution panel of each open failure; the
 * failure grid itself is rendered on the server.
 *
 * The monthly window and the FTT are computed in `calidad-db` with the plant
 * timezone, never with the browser clock.
 */

export const metadata: Metadata = {
  title: "Calidad — OptiFlow",
};

const ENTERO = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

const ESTILO_ESTADO: Record<EstadoQMS, string> = {
  Pendiente: "bg-pausa/15 text-pausa ring-pausa/40",
  "En Reproceso": "bg-cian/15 text-cian ring-cian/40",
  Resuelto: "bg-proceso/15 text-proceso ring-proceso/40",
  Descartado: "bg-white/10 text-white/45 ring-white/20",
};

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
}: {
  titulo: string;
  descripcion: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <header>
        <h2 className="text-sm font-semibold tracking-tight">{titulo}</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-white/40">{descripcion}</p>
      </header>
      {children}
    </section>
  );
}

function Evidencia({ nc }: { nc: NoConformidad }) {
  if (!nc.foto_url) {
    return <span className="font-mono text-[10px] text-white/25">sin foto</span>;
  }

  if (nc.foto_url.startsWith("data:")) {
    return (
      <details>
        <summary className="cursor-pointer text-[11px] text-cian underline decoration-dotted underline-offset-2">
          Ver foto
        </summary>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={nc.foto_url}
          alt={`Evidencia de ${nc.tipo_falla}`}
          className="mt-2 max-h-64 w-full rounded-lg border border-border object-contain"
        />
      </details>
    );
  }

  return (
    <a
      href={nc.foto_url}
      target="_blank"
      rel="noreferrer"
      className="text-[11px] text-cian underline decoration-dotted underline-offset-2"
    >
      Ver foto
    </a>
  );
}

function TarjetaFalla({ nc }: { nc: NoConformidad }) {
  const abierta = nc.estado === "Pendiente" || nc.estado === "En Reproceso";

  return (
    <article className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-xs text-white/50">
            {nc.numero_ot} · {nc.cliente}
          </p>
          <h3 className="mt-0.5 text-sm font-semibold leading-tight">{nc.tipo_falla}</h3>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ring-1 ${ESTILO_ESTADO[nc.estado]}`}
        >
          {nc.estado}
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/45">
        <span>{nc.nombre_sector}</span>
        <span className="text-white/25">·</span>
        <span>{nc.linea_area}</span>
        <span className="text-white/25">·</span>
        <span className="font-mono">{fechaHoraLocal(nc.fecha_registro)}</span>
      </div>

      {nc.observacion ? (
        <p className="text-xs leading-relaxed text-white/65">{nc.observacion}</p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
        <div className="flex flex-col gap-0.5 text-[11px] text-white/40">
          <span>Reportó {nc.encargado_reporta}</span>
          {nc.operario_responsable ? (
            <span>Operario {nc.operario_responsable}</span>
          ) : null}
        </div>
        <Evidencia nc={nc} />
      </div>

      {abierta ? (
        <BotonResolver id={nc.id} numeroOt={nc.numero_ot} />
      ) : (
        <div className="rounded-lg border border-border/60 bg-industrial/40 px-3 py-2 text-[11px] leading-relaxed text-white/50">
          <span className="font-medium text-white/70">
            {nc.resuelto_por ? `Resuelta por ${nc.resuelto_por}` : "Sin resolución"}
          </span>
          {nc.accion_correctiva ? <span> · {nc.accion_correctiva}</span> : null}
        </div>
      )}
    </article>
  );
}

function Pareto({ listado }: { listado: ListadoCalidad }) {
  const tipos = listado.resumen.por_tipo;
  const maximo = Math.max(1, ...tipos.map((tipo) => tipo.cantidad));

  if (tipos.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-white/35">
        Sin fallas registradas en el período.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-2">
      {tipos.map((tipo) => (
        <li key={tipo.tipo_falla} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate text-white/70">{tipo.tipo_falla}</span>
            <span className="font-mono tabular-nums text-white/50">{tipo.cantidad}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-industrial">
            <div
              className="h-full rounded-full bg-alerta"
              style={{ width: `${(tipo.cantidad / maximo) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

function CalidadSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="h-32 animate-pulse rounded-xl bg-card" />
        <div className="h-32 animate-pulse rounded-xl bg-card" />
        <div className="h-32 animate-pulse rounded-xl bg-card" />
        <div className="h-32 animate-pulse rounded-xl bg-card" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="h-96 animate-pulse rounded-xl bg-card" />
        <div className="h-96 animate-pulse rounded-xl bg-card" />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Data-dependent section (inside Suspense)                                    */
/* -------------------------------------------------------------------------- */

async function PanelCalidad() {
  if (!(await sesionActual())) redirect("/login");

  const listado = await listarNoConformidades({ limite: 200 });
  const { resumen } = listado;
  const abiertas = listado.no_conformidades.filter(
    (nc) => nc.estado === "Pendiente" || nc.estado === "En Reproceso",
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/30">
        Período {resumen.desde} — {resumen.hasta} · {listado.no_conformidades.length} registro(s)
        en pantalla
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          etiqueta="Abiertas"
          valor={ENTERO.format(resumen.abiertas_totales)}
          detalle={`${resumen.pendientes} pendiente(s) · ${resumen.en_reproceso} en reproceso`}
          tono={resumen.abiertas_totales > 0 ? "text-pausa" : "text-proceso"}
          nota="Cola real de calidad: no depende del mes."
        />
        <Kpi
          etiqueta="Del mes"
          valor={ENTERO.format(resumen.total_mes)}
          detalle={`${resumen.resueltas_mes} resuelta(s) · ${resumen.descartadas_mes} descartada(s)`}
          tono="text-cian"
          nota={`Ventana local ${resumen.desde} — ${resumen.hasta}`}
        />
        <Kpi
          etiqueta="FTT Calidad"
          valor={resumen.ftt.porcentaje === null ? "—" : `${resumen.ftt.porcentaje.toFixed(1)} %`}
          detalle={
            resumen.ftt.porcentaje === null
              ? "Sin OT avanzadas en el período."
              : `${resumen.ftt.conformes} de ${resumen.ftt.evaluadas} OT sin NC abierta`
          }
          tono="text-proceso"
          nota="First Time Through de calidad: OT que avanzaron sin no conformidad."
        />
        <Kpi
          etiqueta="Falla más recurrente"
          valor={
            resumen.tipo_mas_recurrente
              ? ENTERO.format(resumen.tipo_mas_recurrente.cantidad)
              : "—"
          }
          detalle={resumen.tipo_mas_recurrente?.tipo_falla ?? "Sin fallas en el período."}
          tono="text-alerta"
          nota="Pareto del mes, sin contar las descartadas."
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel
          titulo="Fallas registradas"
          descripcion="Últimas 200 no conformidades. Las abiertas se resuelven acá con su acción correctiva."
        >
          {listado.no_conformidades.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-10 text-center text-sm text-white/35">
              Todavía no hay fallas registradas. La terminal permite reportarlas desde
              una etapa abierta.
            </p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {listado.no_conformidades.map((nc) => (
                <TarjetaFalla key={nc.id} nc={nc} />
              ))}
            </div>
          )}
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel
            titulo="Pareto de fallas"
            descripcion="Distribución del mes por tipo. Las descartadas no ensucian el ranking."
          >
            <Pareto listado={listado} />
          </Panel>

          <Panel
            titulo="Estado de la cola"
            descripcion="Qué necesita atención ahora mismo."
          >
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-border/60 bg-industrial/40 p-3">
                <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">
                  Pendientes
                </dt>
                <dd className="mt-1 font-mono text-2xl tabular-nums text-pausa">
                  {abiertas.filter((nc) => nc.estado === "Pendiente").length}
                </dd>
              </div>
              <div className="rounded-lg border border-border/60 bg-industrial/40 p-3">
                <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">
                  En reproceso
                </dt>
                <dd className="mt-1 font-mono text-2xl tabular-nums text-cian">
                  {abiertas.filter((nc) => nc.estado === "En Reproceso").length}
                </dd>
              </div>
            </dl>
            <p className="text-[11px] leading-relaxed text-white/35">
              Reportar una falla con una etapa en proceso la pausa y detiene la OT en
              una sola transacción. Resolverla exige rol de gestión.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function CalidadPage() {
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Calidad</h1>
        <p className="text-sm text-white/50">
          No conformidades de planta: qué falló, en qué OT, y qué se hizo para
          corregirlo.
        </p>
      </header>

      <Suspense fallback={<CalidadSkeleton />}>
        <PanelCalidad />
      </Suspense>
    </div>
  );
}
