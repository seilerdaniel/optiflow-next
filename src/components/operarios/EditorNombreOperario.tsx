"use client";

import { useState, useTransition } from "react";
import { renombrarOperario } from "@/app/actions/operarios";

/*
 * Inline rename of one operator.
 *
 * Closed it is a discreet "Renombrar" link; open it replaces itself with an
 * input and two buttons, so the table never grows a modal. `useTransition`
 * keeps the row interactive during the round trip and lets the panel close
 * itself on success instead of leaving a stale input on screen (setting state
 * from an effect to do that would trip `react-hooks/set-state-in-effect`).
 */

export default function EditorNombreOperario({
  id,
  nombre,
}: {
  id: number;
  nombre: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState(nombre);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  function abrir() {
    setValor(nombre);
    setError(null);
    setAviso(null);
    setAbierto(true);
  }

  function cancelar() {
    setAbierto(false);
    setError(null);
  }

  function guardar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendiente) return;

    const limpio = valor.trim();
    if (!limpio) {
      setError("El nombre no puede quedar vacío.");
      return;
    }

    iniciar(async () => {
      const resultado = await renombrarOperario(id, limpio);

      if (resultado.ok) {
        setAbierto(false);
        setAviso(resultado.mensaje);
        return;
      }

      setError(resultado.mensaje);
    });
  }

  if (!abierto) {
    return (
      <span className="flex flex-col items-start gap-1">
        <button
          type="button"
          onClick={abrir}
          aria-label={`Renombrar a ${nombre}`}
          className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/30 transition-colors hover:text-cian"
        >
          Renombrar
        </button>
        {aviso ? (
          <span role="status" className="text-[10px] leading-tight text-cian">
            {aviso}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <form onSubmit={guardar} className="flex max-w-[260px] flex-col gap-1.5">
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/35">
          Nuevo nombre
        </span>
        <input
          autoFocus
          maxLength={80}
          autoComplete="off"
          value={valor}
          onChange={(event) => setValor(event.target.value)}
          className="min-h-[36px] w-full rounded-lg border border-border bg-industrial px-2 text-sm text-white outline-none transition-colors focus:border-cian"
        />
      </label>

      {error ? (
        <p role="alert" className="text-[10px] leading-tight text-alerta">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pendiente}
          className="min-h-[32px] rounded-lg bg-cian px-3 text-[11px] font-semibold text-industrial transition-transform active:scale-95 disabled:opacity-60"
        >
          {pendiente ? "Guardando…" : "Guardar"}
        </button>
        <button
          type="button"
          onClick={cancelar}
          disabled={pendiente}
          className="min-h-[32px] rounded-lg border border-border px-3 text-[11px] font-medium text-white/60 transition-colors hover:text-white disabled:opacity-60"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
