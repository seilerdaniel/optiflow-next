"use client";

import { useState } from "react";
import type {
  DetalleOrden,
  MaterialOT,
  OrdenConProgreso,
  RegistroTiempo,
  ResumenMateriales,
  Sector,
} from "@/lib/produccion";
import FlujoStepper from "./FlujoStepper";
import FormConfiguracion from "./FormConfiguracion";
import PanelMateriales from "./PanelMateriales";
import TablaRegistros from "./TablaRegistros";

/*
 * Four local tabs, no navigation and no refetch: the server already shipped the
 * order, its stage history and the sector catalog. Switching tabs only flips a
 * `useState`, so the screen stays instant on a plant tablet.
 */

type TabId = "flujo" | "materiales" | "registros" | "configuracion";

const TABS: ReadonlyArray<{ id: TabId; etiqueta: string }> = [
  { id: "flujo", etiqueta: "Flujo de Trabajo" },
  { id: "materiales", etiqueta: "Materiales & Placas" },
  { id: "registros", etiqueta: "Registros de Tiempo" },
  { id: "configuracion", etiqueta: "Configuración" },
];

export default function TabsDetalle({
  ot,
  registros,
  sectores,
  onActualizada,
  onMateriales,
}: {
  ot: OrdenConProgreso;
  registros: RegistroTiempo[];
  sectores: Sector[];
  onActualizada: (detalle: DetalleOrden) => void;
  onMateriales: (materiales: MaterialOT[], resumen: ResumenMateriales) => void;
}) {
  const [activa, setActiva] = useState<TabId>("flujo");

  const contadores: Record<TabId, string | null> = {
    flujo: `${ot.progreso.sectores_finalizados}/${ot.progreso.sectores_requeridos}`,
    materiales: String(ot.materiales.length),
    registros: String(registros.length),
    configuracion: null,
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label="Secciones de la orden de trabajo"
        className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1"
      >
        {TABS.map((tab) => {
          const seleccionada = activa === tab.id;
          const contador = contadores[tab.id];

          return (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={seleccionada}
              aria-controls={`panel-${tab.id}`}
              onClick={() => setActiva(tab.id)}
              className={`flex min-h-[42px] shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors ${
                seleccionada
                  ? "bg-industrial text-white ring-1 ring-cian/40"
                  : "text-white/55 hover:bg-industrial/60 hover:text-white"
              }`}
            >
              {tab.etiqueta}
              {contador ? (
                <span
                  className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${
                    seleccionada ? "bg-cian/15 text-cian" : "bg-white/5 text-white/40"
                  }`}
                >
                  {contador}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <section
        id={`panel-${activa}`}
        role="tabpanel"
        aria-labelledby={`tab-${activa}`}
        tabIndex={0}
        className="rounded-lg border border-border bg-card p-4 outline-none focus-visible:ring-1 focus-visible:ring-cian/60 md:p-5"
      >
        {activa === "flujo" ? (
          <FlujoStepper ot={ot} sectores={sectores} registros={registros} />
        ) : null}

        {activa === "materiales" ? (
          <PanelMateriales ot={ot} onGuardado={onMateriales} />
        ) : null}

        {activa === "registros" ? <TablaRegistros registros={registros} /> : null}

        {activa === "configuracion" ? (
          <FormConfiguracion ot={ot} onActualizada={onActualizada} />
        ) : null}
      </section>
    </div>
  );
}
