import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import BotonEstadoOperario from "@/components/operarios/BotonEstadoOperario";
import EditorNombreOperario from "@/components/operarios/EditorNombreOperario";
import FormularioOperario from "@/components/operarios/FormularioOperario";
import { fechaHoraLocal, type Operario } from "@/lib/produccion";
import { listarOperarios } from "@/lib/produccion-db";
import { sesionActual } from "@/lib/session-server";

/*
 * Operator master (administration).
 *
 * Server Component: the rows come from `listarOperarios(true)` — every operator,
 * active or not, with its stage count and last activity. Only two islands are
 * client-side: the create form (a Server Action through `useActionState`) and
 * the activate/deactivate switch of each row.
 *
 * Responsive contract: table from `md` up, stacked cards on phones.
 */

export const metadata: Metadata = {
  title: "Operarios — OptiFlow",
};

function BadgeEstado({ activo }: { activo: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] ${
        activo
          ? "border-proceso/40 bg-proceso/15 text-proceso"
          : "border-border bg-white/5 text-white/45"
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${activo ? "bg-proceso" : "bg-white/30"}`}
      />
      {activo ? "Activo" : "Inactivo"}
    </span>
  );
}

function Metrica({
  etiqueta,
  valor,
  tono,
}: {
  etiqueta: string;
  valor: number;
  tono: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">
        {etiqueta}
      </p>
      <p className={`mt-1 font-mono text-lg font-semibold tabular-nums ${tono}`}>{valor}</p>
    </div>
  );
}

/** Stages the operator has registered, with the open ones called out. */
function Etapas({ operario }: { operario: Operario }) {
  return (
    <span className="font-mono text-xs tabular-nums text-white/55">
      {operario.etapas}
      {operario.etapas_abiertas > 0 ? (
        <span className="ml-1.5 rounded-full border border-proceso/40 bg-proceso/15 px-1.5 py-0.5 text-[9px] text-proceso">
          {operario.etapas_abiertas} en curso
        </span>
      ) : null}
    </span>
  );
}

function UltimaActividad({ operario }: { operario: Operario }) {
  if (!operario.ultima_actividad) {
    return <span className="font-mono text-[11px] text-white/30">Sin actividad</span>;
  }

  return (
    <span className="font-mono text-[11px] tabular-nums text-white/55">
      {fechaHoraLocal(operario.ultima_actividad)}
    </span>
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

async function Lista() {
  if (!(await sesionActual())) redirect("/login");

  const operarios = await listarOperarios(true);

  const activos = operarios.filter((operario) => operario.activo).length;
  const enPlanta = operarios.filter((operario) => operario.etapas_abiertas > 0).length;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <div className="order-last flex flex-col gap-3 xl:order-first">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metrica etiqueta="En el maestro" valor={operarios.length} tono="text-white" />
          <Metrica etiqueta="Activos" valor={activos} tono="text-proceso" />
          <Metrica
            etiqueta="Inactivos"
            valor={operarios.length - activos}
            tono="text-white/50"
          />
          <Metrica etiqueta="Con etapa abierta" valor={enPlanta} tono="text-cian" />
        </div>

        {operarios.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card/40 px-4 py-10 text-center">
            <p className="text-sm text-white/60">El maestro de operarios está vacío.</p>
            <p className="mt-1 text-xs text-white/35">
              Cargue el primer operario con el formulario de alta.
            </p>
          </div>
        ) : (
          <>
            {/* Phones: cards */}
            <ul className="flex flex-col gap-2 md:hidden">
              {operarios.map((operario) => (
                <li
                  key={operario.id}
                  className="rounded-lg border border-border bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className={`text-sm font-medium ${
                        operario.activo ? "text-white" : "text-white/45"
                      }`}
                    >
                      {operario.nombre}
                    </p>
                    <BadgeEstado activo={operario.activo} />
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-white/35">
                    <div>
                      <dt>Última actividad</dt>
                      <dd className="mt-0.5 normal-case tracking-normal">
                        <UltimaActividad operario={operario} />
                      </dd>
                    </div>
                    <div>
                      <dt>Etapas</dt>
                      <dd className="mt-0.5 normal-case tracking-normal">
                        <Etapas operario={operario} />
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <BotonEstadoOperario
                      id={operario.id}
                      nombre={operario.nombre}
                      activo={operario.activo}
                    />
                    <EditorNombreOperario id={operario.id} nombre={operario.nombre} />
                  </div>
                </li>
              ))}
            </ul>

            {/* Tablets and up: table */}
            <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-industrial/50 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">
                    <th scope="col" className="px-4 py-3">Operario</th>
                    <th scope="col" className="px-4 py-3">Estado</th>
                    <th scope="col" className="px-4 py-3">Última actividad</th>
                    <th scope="col" className="hidden px-4 py-3 lg:table-cell">
                      Etapas
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {operarios.map((operario) => (
                    <tr
                      key={operario.id}
                      className="border-b border-border/60 last:border-0 hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-3">
                        <span
                          className={`block truncate ${
                            operario.activo ? "text-white" : "text-white/45"
                          }`}
                        >
                          {operario.nombre}
                        </span>
                        <span className="block font-mono text-[10px] text-white/25">
                          Alta {fechaHoraLocal(operario.fecha_creacion)}
                        </span>
                        <span className="mt-1 block">
                          <EditorNombreOperario id={operario.id} nombre={operario.nombre} />
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <BadgeEstado activo={operario.activo} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <UltimaActividad operario={operario} />
                      </td>
                      <td className="hidden px-4 py-3 lg:table-cell">
                        <Etapas operario={operario} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <BotonEstadoOperario
                            id={operario.id}
                            nombre={operario.nombre}
                            activo={operario.activo}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="order-first xl:order-last xl:sticky xl:top-20">
        <FormularioOperario />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function OperariosPage() {
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Operarios</h1>
        <p className="text-sm text-white/50">
          Maestro de personal: alta, estado y actividad registrada en planta.
        </p>
      </header>

      <Suspense fallback={<ListaSkeleton />}>
        <Lista />
      </Suspense>
    </div>
  );
}
