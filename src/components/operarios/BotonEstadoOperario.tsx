"use client";

import { useState, useTransition } from "react";
import { toggleOperario } from "@/app/actions/operarios";

/*
 * Activate / deactivate switch of one operator row.
 *
 * The button lives inside the list, but the mutation is a Server Action: it is
 * the action that revalidates `/operarios`, so the row updates without a full
 * page load. `useTransition` keeps the row responsive while the round trip
 * runs instead of freezing the whole table.
 */

export default function BotonEstadoOperario({
  id,
  nombre,
  activo,
}: {
  id: number;
  nombre: string;
  activo: boolean;
}) {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function alternar() {
    iniciar(async () => {
      const resultado = await toggleOperario(id, activo);
      setError(resultado.ok ? null : resultado.mensaje);
    });
  }

  const etiqueta = activo ? "Desactivar" : "Activar";

  return (
    <span className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={alternar}
        disabled={pendiente}
        aria-label={`${etiqueta} a ${nombre}`}
        aria-busy={pendiente}
        className={`min-h-[36px] rounded-lg border px-3 text-xs font-medium transition-colors disabled:opacity-50 ${
          activo
            ? "border-border text-white/60 hover:border-alerta/60 hover:text-alerta"
            : "border-cian/50 bg-cian/10 text-cian hover:bg-cian/20"
        }`}
      >
        {pendiente ? "…" : etiqueta}
      </button>
      {error ? (
        <span role="alert" className="max-w-[180px] text-[10px] leading-tight text-alerta">
          {error}
        </span>
      ) : null}
    </span>
  );
}
