"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorApi, pedirJson } from "@/lib/api-client";
import {
  ESTADOS_OT,
  LINEAS_OT,
  fechaHoraLocal,
  type DetalleOrden,
  type EstadoOT,
  type LineaOT,
  type OrdenConProgreso,
} from "@/lib/produccion";
import { CAMPO } from "./ui";

/*
 * Editable attributes of the order.
 *
 * `linea_area` is locked once any stage has been finished: changing it re-scopes
 * which sectors the order requires, which would leave the progress and the
 * historical reports inconsistent. The API enforces the same rule (409), this
 * is just the friendly half.
 */

type ClaveEspecial = "requiere_vidrio" | "requiere_lustre" | "requiere_herreria" | "requiere_especiales";

const ESPECIALES: Array<{ clave: ClaveEspecial; etiqueta: string }> = [
  { clave: "requiere_vidrio", etiqueta: "Vidrio" },
  { clave: "requiere_lustre", etiqueta: "Lustre" },
  { clave: "requiere_herreria", etiqueta: "Herrería" },
  { clave: "requiere_especiales", etiqueta: "Especiales" },
];

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
  estado_general: EstadoOT;
}

function desdeOT(ot: OrdenConProgreso): Formulario {
  return {
    numero_ot: ot.numero_ot,
    cliente: ot.cliente,
    modelo: ot.modelo ?? "",
    linea_area: ot.linea_area,
    metros_lineales: String(ot.metros_lineales),
    fecha_prometida: ot.fecha_prometida ?? "",
    requiere_vidrio: ot.requiere_vidrio,
    requiere_lustre: ot.requiere_lustre,
    requiere_herreria: ot.requiere_herreria,
    requiere_especiales: ot.requiere_especiales,
    estado_general: ot.estado_general,
  };
}

export default function FormConfiguracion({
  ot,
  onActualizada,
}: {
  ot: OrdenConProgreso;
  onActualizada: (detalle: DetalleOrden) => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Formulario>(() => desdeOT(ot));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const lineaBloqueada = ot.progreso.sectores_finalizados > 0;

  function actualizar<K extends keyof Formulario>(clave: K, valor: Formulario[K]) {
    setForm((previo) => ({ ...previo, [clave]: valor }));
    setOk(null);
  }

  async function guardar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (guardando) return;

    setGuardando(true);
    setError(null);
    setOk(null);

    try {
      const detalle = await pedirJson<DetalleOrden & { ok: true }>(
        `/api/ordenes/${ot.id}`,
        { method: "PATCH", body: JSON.stringify(form) },
      );

      onActualizada(detalle);
      setForm(desdeOT(detalle.ot));
      setOk("Cambios guardados.");
      router.refresh();
    } catch (fallo) {
      setError(
        fallo instanceof ErrorApi
          ? fallo.accion
            ? `${fallo.message} ${fallo.accion}`
            : fallo.message
          : "No se pudieron guardar los cambios.",
      );
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/60">
            Configuración de la OT
          </h2>
          <p className="mt-1 text-xs text-white/40">
            Atributos editables. El número de OT debe ser único en el sistema.
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/30">
          Actualizada {fechaHoraLocal(ot.fecha_actualizacion)}
        </span>
      </header>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/45">
            N° de OT
          </span>
          <input
            required
            maxLength={40}
            value={form.numero_ot}
            onChange={(event) => actualizar("numero_ot", event.target.value)}
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
            disabled={lineaBloqueada || guardando}
            onChange={(event) => actualizar("linea_area", event.target.value as LineaOT)}
            className={`${CAMPO} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {LINEAS_OT.map((linea) => (
              <option key={linea} value={linea}>
                {linea}
              </option>
            ))}
          </select>
          {lineaBloqueada ? (
            <span className="text-[10px] leading-tight text-pausa/80">
              Bloqueada: la OT ya tiene {ot.progreso.sectores_finalizados} sector(es)
              finalizado(s).
            </span>
          ) : null}
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

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/45">
            Estado general
          </span>
          <select
            value={form.estado_general}
            disabled={guardando}
            onChange={(event) => actualizar("estado_general", event.target.value as EstadoOT)}
            className={CAMPO}
          >
            {ESTADOS_OT.map((estado) => (
              <option key={estado} value={estado}>
                {estado}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="flex flex-col gap-2 md:col-span-2 xl:col-span-2">
          <legend className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/45">
            Requiere
          </legend>
          <div className="flex flex-wrap gap-2">
            {ESPECIALES.map((especial) => (
              <label
                key={especial.clave}
                className="flex min-h-[40px] items-center gap-2 rounded-lg border border-border bg-industrial px-3 text-sm text-white/70"
              >
                <input
                  type="checkbox"
                  checked={form[especial.clave]}
                  onChange={(event) => actualizar(especial.clave, event.target.checked)}
                  className="h-4 w-4 accent-cian"
                />
                {especial.etiqueta}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-alerta/40 bg-alerta/10 px-3 py-2 text-sm text-white/85"
        >
          {error}
        </p>
      ) : null}

      {ok ? (
        <p
          role="status"
          className="rounded-lg border border-proceso/40 bg-proceso/10 px-3 py-2 text-sm text-white/85"
        >
          {ok}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => {
            setForm(desdeOT(ot));
            setError(null);
            setOk(null);
          }}
          disabled={guardando}
          className="min-h-[44px] rounded-lg border border-border px-4 text-sm font-medium text-white/70 transition-colors hover:text-white disabled:opacity-50"
        >
          Restablecer
        </button>
        <button
          type="submit"
          disabled={guardando}
          className="min-h-[44px] rounded-lg bg-cian px-4 text-sm font-semibold text-industrial transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {guardando ? "Guardando…" : "Guardar cambios"}
        </button>
      </div>
    </form>
  );
}
