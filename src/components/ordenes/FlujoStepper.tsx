import {
  construirNodosFlujo,
  minutosLegibles,
  tiempoSugeridoMinutos,
  type OrdenConProgreso,
  type RegistroTiempo,
  type Sector,
} from "@/lib/produccion";
import { NODO_ESTILO } from "./ui";

/*
 * The order's route as a stepper: one node per required sector, in flow order.
 *
 * Vertical timeline on phones (readable one-handed), horizontal rail from
 * `lg` up (the office reads it left to right, like the physical route sheet).
 * When a sector is already finished, the real accumulated minutes replace the
 * estimate so the office can compare pace without opening another screen.
 */

export default function FlujoStepper({
  ot,
  sectores,
  registros,
}: {
  ot: OrdenConProgreso;
  sectores: Sector[];
  registros: RegistroTiempo[];
}) {
  const nodos = construirNodosFlujo(ot, sectores);

  const reales = new Map<number, number>();
  for (const registro of registros) {
    if (registro.estado_etapa !== "Finalizado") continue;
    const previo = reales.get(registro.sector_id) ?? 0;
    reales.set(
      registro.sector_id,
      Math.round((previo + (registro.duracion_minutos ?? 0)) * 10) / 10,
    );
  }

  if (nodos.length === 0) {
    return (
      <p className="text-sm text-white/40">
        Esta OT no tiene sectores configurados para su línea.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/60">
            Flujo de trabajo
          </h2>
          <p className="mt-1 text-xs text-white/40">
            Secuencia de sectores de la línea {ot.linea_area}. Los compartidos se
            usan desde ambas líneas.
          </p>
        </div>
        <span className="rounded-full border border-border bg-industrial px-2.5 py-1 font-mono text-[11px] tabular-nums text-white/60">
          {ot.progreso.sectores_finalizados}/{ot.progreso.sectores_requeridos} finalizados
        </span>
      </header>

      <ol className="flex flex-col gap-2 lg:flex-row lg:gap-1.5 lg:overflow-x-auto lg:pb-2">
        {nodos.map((nodo, indice) => {
          const estilo = NODO_ESTILO[nodo.estado];
          const real = reales.get(nodo.sector.id);
          const estimado = tiempoSugeridoMinutos(
            nodo.sector.estandar_min_por_metro,
            ot.metros_lineales,
          );

          return (
            <li key={nodo.sector.id} className="relative lg:min-w-[172px] lg:flex-1">
              <div
                className={`flex h-full flex-col gap-2 rounded-lg border p-3 ${estilo.caja}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] tabular-nums text-white/35">
                    {String(indice + 1).padStart(2, "0")}
                  </span>
                  <span aria-hidden="true" className="text-sm leading-none">
                    {estilo.icono}
                  </span>
                </div>

                <div className="flex flex-col">
                  <span className="text-sm font-medium leading-tight">
                    {nodo.sector.nombre_corto || nodo.sector.nombre_sector}
                  </span>
                  <span className="mt-0.5 text-[10px] uppercase tracking-[0.1em] text-white/45">
                    {estilo.etiqueta}
                  </span>
                </div>

                {nodo.sector.es_compartido ? (
                  <span className="w-fit rounded border border-compartidos/50 bg-compartidos/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-white/70">
                    [compartido]
                  </span>
                ) : null}

                <p className="mt-auto font-mono text-[10px] tabular-nums text-white/40">
                  {real !== undefined ? (
                    <>
                      <span className={real > estimado ? "text-pausa" : "text-proceso"}>
                        Real {minutosLegibles(real)}
                      </span>
                      {" · "}
                      Est. {minutosLegibles(estimado)}
                    </>
                  ) : (
                    <>Est. {minutosLegibles(estimado)}</>
                  )}
                </p>

                {nodo.motivo ? (
                  <p className="text-[10px] leading-tight text-pausa/80">{nodo.motivo}</p>
                ) : null}
              </div>

              {indice < nodos.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-1.5 top-1/2 hidden -translate-y-1/2 font-mono text-white/20 lg:block"
                >
                  ›
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
