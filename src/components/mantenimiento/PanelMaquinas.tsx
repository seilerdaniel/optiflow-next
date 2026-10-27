"use client";

import { useState, useTransition } from "react";
import { guardarMaquina, registrarService } from "@/app/actions/mantenimiento";
import { CAMPO } from "@/components/ordenes/ui";
import type { ResultadoAccion } from "@/lib/acciones";
import type {
  EntradaMaquina,
  EstadoTPM,
  MaquinaTPM,
} from "@/lib/mantenimiento";
import type { Sector } from "@/lib/produccion";

/*
 * Maintenance cards + dialogs.
 *
 * Client island on purpose: opening a dialog, keeping the typed text and
 * awaiting the Server Action are interactions. The numbers arrive already
 * computed from `listarMantenimiento`, so the browser never recalculates the
 * usage percentage — the terminal banner and this table cannot disagree.
 *
 * A service does NOT reset the sector accumulator (T3): the action snapshots
 * it, so the card shows "0 h desde el service" while the lifetime hours stay.
 */

const ESTILO_ESTADO: Record<EstadoTPM, { badge: string; barra: string; texto: string }> = {
  ok: {
    badge: "bg-proceso/15 text-proceso ring-proceso/40",
    barra: "bg-proceso",
    texto: "text-proceso",
  },
  advertencia: {
    badge: "bg-pausa/15 text-pausa ring-pausa/40",
    barra: "bg-pausa",
    texto: "text-pausa",
  },
  critico: {
    badge: "bg-alerta/15 text-alerta ring-alerta/40",
    barra: "bg-alerta",
    texto: "text-alerta",
  },
};

const ETIQUETA_ESTADO: Record<EstadoTPM, string> = {
  ok: "OK",
  advertencia: "Advertencia",
  critico: "Crítico",
};

type Editor =
  | { modo: "nueva" }
  | { modo: "editar"; maquina: MaquinaTPM };

function numeroOpcional(valor: string): number | undefined {
  const limpio = valor.trim().replace(",", ".");
  if (!limpio) return undefined;
  const numero = Number(limpio);
  return Number.isFinite(numero) ? numero : undefined;
}

export default function PanelMaquinas({
  maquinas,
  sectores,
}: {
  maquinas: MaquinaTPM[];
  sectores: Sector[];
}) {
  const [servicio, setServicio] = useState<MaquinaTPM | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [estado, setEstado] = useState<ResultadoAccion | null>(null);
  const [pendiente, iniciar] = useTransition();

  const [tecnico, setTecnico] = useState("");
  const [observaciones, setObservaciones] = useState("");

  const [sectorId, setSectorId] = useState("");
  const [nombre, setNombre] = useState("");
  const [tarea, setTarea] = useState("");
  const [intervalo, setIntervalo] = useState("100");
  const [horasBase, setHorasBase] = useState("");
  const [activo, setActivo] = useState(true);

  function abrirServicio(maquina: MaquinaTPM) {
    setEstado(null);
    setTecnico("");
    setObservaciones("");
    setServicio(maquina);
  }

  function abrirNueva() {
    setEstado(null);
    setSectorId(sectores[0] ? String(sectores[0].id) : "");
    setNombre("");
    setTarea("");
    setIntervalo("100");
    setHorasBase("");
    setActivo(true);
    setEditor({ modo: "nueva" });
  }

  function abrirEdicion(maquina: MaquinaTPM) {
    setEstado(null);
    setSectorId(String(maquina.sector_id));
    setNombre(maquina.nombre_maquina);
    setTarea(maquina.tarea_mantenimiento);
    setIntervalo(String(maquina.intervalo_horas_target));
    setHorasBase(String(maquina.horas_ultimo_mantenimiento));
    setActivo(maquina.activo);
    setEditor({ modo: "editar", maquina });
  }

  function enviarServicio(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!servicio) return;

    iniciar(async () => {
      const resultado = await registrarService({
        maquina_tpm_id: servicio.id,
        tecnico_operario: tecnico,
        observaciones: observaciones.trim() || undefined,
      });
      setEstado(resultado);
      if (resultado.ok) setServicio(null);
    });
  }

  function enviarMaquina(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const entrada: EntradaMaquina = {
      sector_id: Number(sectorId),
      nombre_maquina: nombre,
      tarea_mantenimiento: tarea,
      intervalo_horas_target: numeroOpcional(intervalo) ?? 100,
      horas_ultimo_mantenimiento: numeroOpcional(horasBase),
      activo,
    };

    if (editor?.modo === "editar") entrada.id = editor.maquina.id;

    iniciar(async () => {
      const resultado = await guardarMaquina(entrada);
      setEstado(resultado);
      if (resultado.ok) setEditor(null);
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Máquinas</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-white/40">
            Uso medido en horas netas del sector: sólo etapas finalizadas, sin pausas.
          </p>
        </div>
        <button
          type="button"
          onClick={abrirNueva}
          className="min-h-[44px] touch-manipulation rounded-lg border border-border bg-card px-4 text-sm font-medium transition-transform active:scale-95"
        >
          Nueva máquina
        </button>
      </header>

      {maquinas.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card/60 px-4 py-10 text-center text-sm text-white/35">
          No hay máquinas configuradas. Cree la primera para empezar a medir el
          mantenimiento preventivo.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {maquinas.map((maquina) => {
            const estilo = ESTILO_ESTADO[maquina.estado];
            const pct = Math.max(0, maquina.pct_uso);
            const barra = Math.min(100, pct);

            return (
              <article
                key={maquina.id}
                className={`flex flex-col gap-3 rounded-xl border border-border bg-card p-4 ${
                  maquina.activo ? "" : "opacity-60"
                }`}
              >
                <header className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold leading-tight">
                      {maquina.nombre_maquina}
                    </h3>
                    <p className="mt-0.5 text-[11px] text-white/40">
                      {maquina.nombre_sector} · {maquina.linea_area}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ring-1 ${estilo.badge}`}
                  >
                    {ETIQUETA_ESTADO[maquina.estado]}
                  </span>
                </header>

                <div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`font-mono text-3xl font-semibold tabular-nums ${estilo.texto}`}>
                      {pct.toFixed(1)} %
                    </span>
                    <span className="font-mono text-[11px] text-white/40">
                      {maquina.horas_desde_ultimo_mantenimiento.toFixed(1)} /{" "}
                      {maquina.intervalo_horas_target.toFixed(0)} h
                    </span>
                  </div>
                  <div
                    className="mt-2 h-2 overflow-hidden rounded-full bg-industrial"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.min(100, Math.round(pct))}
                    aria-label={`Uso de ${maquina.nombre_maquina}`}
                  >
                    <div
                      className={`h-full rounded-full ${estilo.barra}`}
                      style={{ width: `${barra}%` }}
                    />
                  </div>
                  <p className="mt-1.5 font-mono text-[10px] text-white/30">
                    {maquina.horas_restantes.toFixed(1)} h restantes · acumulado del
                    sector {maquina.horas_acumuladas_sector.toFixed(1)} h
                  </p>
                </div>

                <p className="text-xs leading-relaxed text-white/55">
                  {maquina.tarea_mantenimiento}
                </p>

                <div className="mt-auto flex flex-wrap gap-2 border-t border-border/60 pt-3">
                  <button
                    type="button"
                    onClick={() => abrirServicio(maquina)}
                    className="min-h-[40px] touch-manipulation rounded-lg bg-cian px-3 text-xs font-semibold text-industrial transition-transform active:scale-95"
                  >
                    Registrar service
                  </button>
                  <button
                    type="button"
                    onClick={() => abrirEdicion(maquina)}
                    className="min-h-[40px] touch-manipulation rounded-lg border border-border bg-industrial px-3 text-xs font-medium text-white/70 transition-transform active:scale-95"
                  >
                    Editar
                  </button>
                  {!maquina.activo ? (
                    <span className="self-center font-mono text-[10px] uppercase tracking-[0.12em] text-white/35">
                      Inactiva
                    </span>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Service dialog */}
      {servicio ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Registrar service de ${servicio.nombre_maquina}`}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
        >
          <form
            onSubmit={enviarServicio}
            className="flex w-full max-w-lg flex-col gap-3 rounded-t-2xl border border-border bg-industrial p-5 sm:rounded-2xl"
          >
            <header className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold tracking-tight">
                  Service · {servicio.nombre_maquina}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-white/45">
                  Se guarda una foto de las horas netas del sector (
                  {servicio.horas_acumuladas_sector.toFixed(1)} h) en el historial. El
                  acumulado de la máquina no se borra.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setServicio(null)}
                className="rounded-lg border border-border px-2 py-1 text-xs text-white/60"
              >
                Cerrar
              </button>
            </header>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">
                Técnico / operario
              </span>
              <input
                value={tecnico}
                onChange={(event) => setTecnico(event.target.value)}
                required
                maxLength={120}
                autoComplete="off"
                className={CAMPO}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">
                Observaciones (opcional)
              </span>
              <textarea
                value={observaciones}
                onChange={(event) => setObservaciones(event.target.value)}
                maxLength={1_000}
                rows={3}
                className={`${CAMPO} min-h-[80px] py-2`}
              />
            </label>

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

            <button
              type="submit"
              disabled={pendiente}
              className="min-h-[48px] touch-manipulation rounded-lg bg-cian px-4 text-sm font-semibold text-industrial transition-transform active:scale-95 disabled:opacity-60"
            >
              {pendiente ? "Guardando…" : "Confirmar service"}
            </button>
          </form>
        </div>
      ) : null}

      {/* Machine dialog (create/edit) */}
      {editor ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editor.modo === "nueva" ? "Nueva máquina" : "Editar máquina"}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
        >
          <form
            onSubmit={enviarMaquina}
            className="flex max-h-[92vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-t-2xl border border-border bg-industrial p-5 sm:rounded-2xl"
          >
            <header className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold tracking-tight">
                  {editor.modo === "nueva" ? "Nueva máquina" : `Editar ${editor.maquina.nombre_maquina}`}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-white/45">
                  El intervalo es la meta de horas netas entre services. Los campos
                  vacíos conservan el valor guardado.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditor(null)}
                className="rounded-lg border border-border px-2 py-1 text-xs text-white/60"
              >
                Cerrar
              </button>
            </header>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">
                Sector
              </span>
              <select
                value={sectorId}
                onChange={(event) => setSectorId(event.target.value)}
                required
                className={CAMPO}
              >
                <option value="">Seleccione un sector…</option>
                {sectores.map((sector) => (
                  <option key={sector.id} value={String(sector.id)}>
                    {sector.nombre_sector} · {sector.linea_area}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">
                Nombre de la máquina
              </span>
              <input
                value={nombre}
                onChange={(event) => setNombre(event.target.value)}
                required
                maxLength={160}
                className={CAMPO}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">
                Tarea de mantenimiento
              </span>
              <input
                value={tarea}
                onChange={(event) => setTarea(event.target.value)}
                required
                maxLength={300}
                placeholder="Ej. Engrase de guías y calibración de escuadra"
                className={CAMPO}
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">
                  Meta (horas)
                </span>
                <input
                  value={intervalo}
                  onChange={(event) => setIntervalo(event.target.value)}
                  required
                  inputMode="decimal"
                  className={CAMPO}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">
                  Baseline (horas)
                </span>
                <input
                  value={horasBase}
                  onChange={(event) => setHorasBase(event.target.value)}
                  inputMode="decimal"
                  placeholder="Conservar"
                  className={CAMPO}
                />
              </label>
            </div>

            <label className="flex items-center gap-2 text-xs text-white/60">
              <input
                type="checkbox"
                checked={activo}
                onChange={(event) => setActivo(event.target.checked)}
                className="h-4 w-4 accent-cian"
              />
              Activa (sólo las activas avisan en la terminal)
            </label>

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

            <button
              type="submit"
              disabled={pendiente}
              className="min-h-[48px] touch-manipulation rounded-lg bg-cian px-4 text-sm font-semibold text-industrial transition-transform active:scale-95 disabled:opacity-60"
            >
              {pendiente ? "Guardando…" : "Guardar máquina"}
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
