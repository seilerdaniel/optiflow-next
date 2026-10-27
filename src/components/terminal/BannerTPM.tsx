"use client";

import { useState } from "react";
import type { MaquinaTPM } from "@/lib/mantenimiento";

/*
 * Floating TPM warning for the terminal.
 *
 * Only machines of the SELECTED sector are considered: the operator is about to
 * work there, so a critical machine anywhere else is noise. It is dismissible
 * per sector and set of machines, so it comes back if a new machine turns
 * critical but does not nag after the operator acknowledged it.
 */

export default function BannerTPM({
  criticas,
  sectorId,
  sectorNombre,
}: {
  criticas: MaquinaTPM[];
  sectorId: number | null;
  sectorNombre: string | null;
}) {
  const [descartado, setDescartado] = useState<string | null>(null);

  if (sectorId === null) return null;

  const delSector = criticas.filter((maquina) => maquina.sector_id === sectorId);
  if (delSector.length === 0) return null;

  const clave = `${sectorId}:${delSector.map((maquina) => maquina.id).join(",")}`;
  if (descartado === clave) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-xl items-start gap-3 rounded-xl border border-alerta/60 bg-[#2a1518] p-4 shadow-[0_12px_40px_rgba(0,0,0,0.55)] sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2"
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-alerta/20 font-mono text-sm font-bold text-alerta"
      >
        !
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">
          Mantenimiento vencido en {sectorNombre ?? "el sector"}
        </p>
        <ul className="mt-1 flex flex-col gap-0.5 text-xs leading-relaxed text-white/70">
          {delSector.map((maquina) => (
            <li key={maquina.id}>
              <span className="font-medium text-white/90">{maquina.nombre_maquina}</span>{" "}
              · {maquina.pct_uso.toFixed(0)} % · {maquina.tarea_mantenimiento}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-[11px] text-white/40">
          Avisar al encargado antes de seguir produciendo.
        </p>
      </div>

      <button
        type="button"
        onClick={() => setDescartado(clave)}
        aria-label="Ocultar aviso de mantenimiento"
        className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs text-white/60"
      >
        Ocultar
      </button>
    </div>
  );
}
