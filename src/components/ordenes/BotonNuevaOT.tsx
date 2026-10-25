"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorApi, pedirJson } from "@/lib/api-client";
import { LINEAS_OT, type LineaOT, type OrdenTrabajo } from "@/lib/produccion";
import { CAMPO } from "./ui";

/*
 * "+ Nueva OT" — a dependency-free modal that creates the order and jumps
 * straight to its detail page. Only the fields the plant needs to start
 * scheduling are asked for; materials are loaded later from the detail tabs.
 */

interface Formulario {
  numero_ot: string;
  cliente: string;
  modelo: string;
  linea_area: LineaOT;
  metros_lineales: string;
  fecha_prometida: string;
  requiere_vidrio: boolean;
  requiere_lustre: boolean;
  requiere_herreria: boolean;
  requiere_especiales: boolean;
}

const INICIAL: Formulario = {
  numero_ot: "",
  cliente: "",
  modelo: "",
  linea_area: "Placares",
  metros_lineales: "",
  fecha_prometida: "",
  requiere_vidrio: false,
  requiere_lustre: false,
  requiere_herreria: false,
  requiere_especiales: false,
};

type ClaveEspecialFormulario =
  | "requiere_vidrio"
  | "requiere_lustre"
  | "requiere_herreria"
  | "requiere_especiales";

const ESPECIALES: Array<{ clave: ClaveEspecialFormulario; etiqueta: string }> = [
  { clave: "requiere_vidrio", etiqueta: "Vidrio" },
  { clave: "requiere_lustre", etiqueta: "Lustre" },
  { clave: "requiere_herreria", etiqueta: "Herrería" },
  { clave: "requiere_especiales", etiqueta: "Especiales" },
];

export default function BotonNuevaOT() {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState<Formulario>(INICIAL);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!abierto) return;

    function alPresionar(event: KeyboardEvent) {
      if (event.key === "Escape") setAbierto(false);
    }

    window.addEventListener("keydown", alPresionar);
    return () => window.removeEventListener("keydown", alPresionar);
  }, [abierto]);

  function abrir() {
    setForm(INICIAL);
    setError(null);
    setAbierto(true);
  }

  function actualizar<K extends keyof Formulario>(clave: K, valor: Formulario[K]) {
    setForm((previo) => ({ ...previo, [clave]: valor }));
  }

  async function crear(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (enviando) return;

    setEnviando(true);
    setError(null);

    try {
      const respuesta = await pedirJson<{ ok: true; ot: OrdenTrabajo }>("/api/ordenes", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          numero_ot: form.numero_ot.trim(),
          cliente: form.cliente.trim(),
          modelo: form.modelo.trim() || null,
          fecha_prometida: form.fecha_prometida || null,
        }),
      });

      setAbierto(false);
      router.push(`/ordenes/${respuesta.ot.id}`);
      router.refresh();
    } catch (fallo) {
      setError(
        fallo instanceof ErrorApi
          ? fallo.message
          : "No se pudo crear la OT. Intente nuevamente.",
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        className="min-h-[44px] touch-manipulation rounded-lg bg-cian px-4 text-sm font-semibold text-industrial transition-transform active:scale-95"
      >
        + Nueva OT
      </button>

      {abierto ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 py-8 md:items-center"
          onClick={() => setAbierto(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="nueva-ot-titulo"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="nueva-ot-titulo" className="text-lg font-semibold tracking-tight">
                  Nueva orden de trabajo
                </h2>
                <p className="mt-1 text-xs text-white/45">
                  Se crea en estado «En Cola». Los materiales se cargan desde el detalle.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                aria-label="Cerrar"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-white/60 transition-colors hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={crear} className="mt-4 flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/45">
                    N° de OT
                  </span>
                  <input
                    required
                    autoFocus
                    maxLength={40}
                    value={form.numero_ot}
                    onChange={(event) => actualizar("numero_ot", event.target.value)}
                    placeholder="OT-1714"
                    className={`${CAMPO} font-mono uppercase`}
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/45">
                    Cliente
                  </span>
                  <input
                    required
                    maxLength={120}
                    value={form.cliente}
                    onChange={(event) => actualizar("cliente", event.target.value)}
                    placeholder="Muebles Pérez"
                    className={CAMPO}
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/45">
                    Modelo
                  </span>
                  <input
                    maxLength={80}
                    value={form.modelo}
                    onChange={(event) => actualizar("modelo", event.target.value)}
                    placeholder="Opcional"
                    className={CAMPO}
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/45">
                    Línea
                  </span>
                  <select
                    value={form.linea_area}
                    onChange={(event) => actualizar("linea_area", event.target.value as LineaOT)}
                    className={CAMPO}
                  >
                    {LINEAS_OT.map((linea) => (
                      <option key={linea} value={linea}>
                        {linea}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/45">
                    Metros lineales
                  </span>
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.1"
                    inputMode="decimal"
                    value={form.metros_lineales}
                    onChange={(event) => actualizar("metros_lineales", event.target.value)}
                    placeholder="0.0"
                    className={`${CAMPO} font-mono`}
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/45">
                    Fecha prometida
                  </span>
                  <input
                    type="date"
                    value={form.fecha_prometida}
                    onChange={(event) => actualizar("fecha_prometida", event.target.value)}
                    className={`${CAMPO} font-mono`}
                  />
                </label>
              </div>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/45">
                  Requiere
                </legend>
                <div className="flex flex-wrap gap-3">
                  {ESPECIALES.map((especial) => (
                    <label
                      key={especial.clave}
                      className="flex min-h-[36px] items-center gap-2 rounded-lg border border-border bg-industrial px-3 text-sm text-white/70"
                    >
                      <input
                        type="checkbox"
                        checked={form[especial.clave]}
                        onChange={(event) =>
                          actualizar(especial.clave, event.target.checked)
                        }
                        className="h-4 w-4 accent-cian"
                      />
                      {especial.etiqueta}
                    </label>
                  ))}
                </div>
              </fieldset>

              {error ? (
                <p role="alert" className="rounded-lg border border-alerta/40 bg-alerta/10 px-3 py-2 text-sm text-white/85">
                  {error}
                </p>
              ) : null}

              <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setAbierto(false)}
                  className="min-h-[44px] rounded-lg border border-border px-4 text-sm font-medium text-white/70 transition-colors hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={enviando}
                  className="min-h-[44px] rounded-lg bg-cian px-4 text-sm font-semibold text-industrial transition-transform active:scale-95 disabled:opacity-60"
                >
                  {enviando ? "Creando…" : "Crear OT"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
