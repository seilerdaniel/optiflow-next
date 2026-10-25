"use client";

import { useSyncExternalStore } from "react";
import {
  formatearDuracion,
  horaLocal,
  minutosTranscurridos,
  tiempoSugeridoMinutos,
  type RegistroTiempo,
} from "@/lib/produccion";

/*
 * "Live status" card for the stage that is currently open on the selected
 * order.
 *
 * The clock is driven by a module-level ticker instead of a `setInterval`
 * inside the component: several cards share one timer, and `useSyncExternal
 * Store` gives an immediate value after hydration (no `Date.now()` during
 * render, so server and client markup never disagree).
 */

let tickMs = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);

  if (listeners.size === 1) {
    tickMs = Date.now();
    timer = setInterval(() => {
      tickMs = Date.now();
      listeners.forEach((notify) => notify());
    }, 1000);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = (): number | null => tickMs;
const getServerSnapshot = (): number | null => null;

const ESTADO_UI: Record<string, { etiqueta: string; clase: string }> = {
  "En Proceso": { etiqueta: "En proceso", clase: "bg-proceso/15 text-proceso ring-proceso/40" },
  Pausado: { etiqueta: "En pausa", clase: "bg-pausa/15 text-pausa ring-pausa/40" },
  Finalizado: { etiqueta: "Finalizada", clase: "bg-white/10 text-white/60 ring-white/20" },
};

export interface CronometroEnVivoProps {
  registro: RegistroTiempo;
  numeroOt: string;
  sectorNombre: string;
  /** Sector standard, in minutes of work per linear metre. */
  estandarMinPorMetro: number;
  /** Order length in linear metres; scales the standard into a limit. */
  metrosLineales: number;
}

export default function CronometroEnVivo({
  registro,
  numeroOt,
  sectorNombre,
  estandarMinPorMetro,
  metrosLineales,
}: CronometroEnVivoProps) {
  const ahora = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const finalizada = registro.estado_etapa === "Finalizado";
  const minutos = finalizada
    ? (registro.duracion_minutos ?? 0)
    : ahora === null
      ? null
      : minutosTranscurridos(registro, ahora);

  const sugerido = tiempoSugeridoMinutos(estandarMinPorMetro, metrosLineales);
  const excedido = minutos !== null && minutos > sugerido;
  const exceso = minutos !== null && excedido ? minutos - sugerido : 0;

  const estadoUI = ESTADO_UI[registro.estado_etapa] ?? {
    etiqueta: registro.estado_etapa,
    clase: "bg-white/10 text-white/60 ring-white/20",
  };

  return (
    <section
      aria-label="Estado en vivo de la etapa"
      className={`relative overflow-hidden rounded-lg border bg-card p-4 transition-colors ${
        excedido ? "border-alerta" : "border-border"
      }`}
    >
      {/* Pulsing border only: the text itself must stay readable. */}
      {excedido ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 animate-pulse rounded-lg border-2 border-alerta"
        />
      ) : null}

      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold tracking-tight">{numeroOt}</p>
          <p className="truncate text-xs text-white/50">
            {sectorNombre} · {registro.operario_nombre}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] ring-1 ${estadoUI.clase}`}
        >
          {estadoUI.etiqueta}
        </span>
      </header>

      <div className="mt-3 flex items-end justify-between gap-3">
        <p
          aria-live="off"
          className={`font-mono text-4xl font-semibold leading-none tabular-nums transition-colors ${
            excedido ? "text-alerta" : "text-white"
          }`}
        >
          {minutos === null ? "--:--:--" : formatearDuracion(minutos)}
        </p>

        <div className="text-right leading-tight">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-gray-400">
            Tiempo sugerido
          </p>
          <p className="font-mono text-sm tabular-nums text-gray-400">
            {formatearDuracion(sugerido)}
          </p>
        </div>
      </div>

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">
        <span>Inicio {horaLocal(registro.fecha_hora_inicio)}</span>
        {excedido ? (
          <span className="text-alerta">
            +{Math.round(exceso)} min sobre el estándar
          </span>
        ) : (
          <span>Estándar {estandarMinPorMetro.toFixed(1)} min/m · {metrosLineales} m</span>
        )}
      </footer>
    </section>
  );
}
