"use client";

import { useActionState, useEffect, useRef } from "react";
import { crearOperario } from "@/app/actions/operarios";
import { CAMPO } from "@/components/ordenes/ui";
import { RESULTADO_INICIAL } from "./tipos";

/*
 * Alta de operarios.
 *
 * Controlled by `useActionState`: the Server Action returns the message
 * instead of throwing, so the failure ("ya está registrado") shows inline and
 * never loses what the plant typed. On success the form clears itself and the
 * revalidated list arrives with the new row already in place — no reload.
 */

export default function FormularioOperario() {
  const [estado, enviar, pendiente] = useActionState(crearOperario, RESULTADO_INICIAL);
  const formulario = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (estado.ok) formulario.current?.reset();
  }, [estado]);

  return (
    <form
      ref={formulario}
      action={enviar}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
    >
      <div>
        <h2 className="text-sm font-semibold tracking-tight">Alta de operario</h2>
        <p className="mt-1 text-xs leading-relaxed text-white/40">
          El nombre normalizado se genera en el servidor: «Pérez» y «Perez» son el
          mismo operario.
        </p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">
          Nombre y apellido
        </span>
        <input
          name="nombre"
          required
          maxLength={80}
          autoComplete="off"
          placeholder="Ej. Juan Pérez"
          className={CAMPO}
        />
      </label>

      <button
        type="submit"
        disabled={pendiente}
        className="min-h-[44px] touch-manipulation rounded-lg bg-cian px-4 text-sm font-semibold text-industrial transition-transform active:scale-95 disabled:opacity-60"
      >
        {pendiente ? "Guardando…" : "Agregar operario"}
      </button>

      {estado.mensaje ? (
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
  );
}
