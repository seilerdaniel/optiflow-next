"use client";

import { useRef, useState, useTransition } from "react";
import { resolverNoConformidad } from "@/app/actions/calidad";
import { CAMPO } from "@/components/ordenes/ui";
import type { ResultadoAccion } from "@/lib/acciones";

/*
 * Resolution panel of one non-conformity.
 *
 * A `<details>` keeps the grid compact until somebody decides to act, and the
 * Server Action is awaited inside a transition so the panel can close only
 * after the server confirmed the write (Q5: the first resolution is final).
 */

export default function BotonResolver({
  id,
  numeroOt,
}: {
  id: number;
  numeroOt: string;
}) {
  const panel = useRef<HTMLDetailsElement>(null);
  const [accion, setAccion] = useState("");
  const [estado, setEstado] = useState<ResultadoAccion | null>(null);
  const [pendiente, iniciar] = useTransition();

  function enviar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    iniciar(async () => {
      const resultado = await resolverNoConformidad(id, accion);
      setEstado(resultado);

      if (resultado.ok) {
        setAccion("");
        if (panel.current) panel.current.open = false;
      }
    });
  }

  return (
    <details ref={panel} className="group">
      <summary className="inline-flex min-h-[36px] cursor-pointer list-none touch-manipulation items-center rounded-lg border border-cian/40 bg-cian/10 px-3 text-xs font-medium text-cian transition-transform active:scale-95 [&::-webkit-details-marker]:hidden">
        Resolver
      </summary>

      <form onSubmit={enviar} className="mt-2 flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">
            Acción correctiva · {numeroOt}
          </span>
          <textarea
            value={accion}
            onChange={(event) => setAccion(event.target.value)}
            required
            maxLength={2_000}
            rows={3}
            placeholder="Qué se hizo para corregir la falla y evitar que se repita"
            className={`${CAMPO} min-h-[80px] py-2`}
          />
        </label>

        <button
          type="submit"
          disabled={pendiente}
          className="min-h-[40px] touch-manipulation rounded-lg bg-cian px-3 text-sm font-semibold text-industrial transition-transform active:scale-95 disabled:opacity-60"
        >
          {pendiente ? "Guardando…" : "Marcar resuelta"}
        </button>

        {estado?.mensaje ? (
          <p
            role={estado.ok ? "status" : "alert"}
            className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${
              estado.ok
                ? "border-cian/40 bg-cian/10 text-white/85"
                : "border-alerta/40 bg-alerta/10 text-white/85"
            }`}
          >
            {estado.mensaje}
          </p>
        ) : null}
      </form>
    </details>
  );
}
