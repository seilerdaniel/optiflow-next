"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import CronometroEnVivo from "./CronometroEnVivo";
import {
  ESTANDAR_POR_DEFECTO,
  MOTIVOS_PAUSA,
  formatearDuracion,
  type LineaArea,
  type MotivoPausa,
  type Operario,
  type OrdenConProgreso,
  type RegistroTiempo,
  type Sector,
} from "@/lib/produccion";

/*
 * Touch-first fichado terminal.
 *
 * One screen, three decisions: order, sector, operator. Everything the API
 * returns is already assembled (`/api/ordenes` ships the blocked sectors and
 * the finished ones), so this component only groups and renders.
 *
 * The clock and the action buttons are sized for a gloved finger on a plant
 * tablet: 56 px minimum targets, `touch-manipulation` to kill the 300 ms tap
 * delay, and a haptic pulse so the operator gets physical confirmation.
 */

/* -------------------------------------------------------------------------- */
/* API plumbing                                                                */
/* -------------------------------------------------------------------------- */

interface RespuestaOrdenes {
  ok: true;
  total: number;
  ordenes: OrdenConProgreso[];
}

interface RespuestaSectores {
  ok: true;
  total: number;
  sectores: Sector[];
}

interface RespuestaOperarios {
  ok: true;
  total: number;
  operarios: Operario[];
}

interface RespuestaAccion {
  ok: true;
  registro: RegistroTiempo;
  ot_auto_cerrada?: boolean;
}

class ErrorApi extends Error {
  readonly status: number;
  readonly accion: string | null;

  constructor(status: number, mensaje: string, accion: string | null) {
    super(mensaje);
    this.name = "ErrorApi";
    this.status = status;
    this.accion = accion;
  }
}

async function pedirJson<T>(
  url: string,
  init?: { method?: string; body?: string },
): Promise<T> {
  const respuesta = await fetch(url, {
    method: init?.method ?? "GET",
    body: init?.body,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });

  const crudo: unknown = await respuesta.json().catch(() => null);
  const cuerpo = (crudo ?? {}) as { ok?: unknown; error?: unknown; accion?: unknown };

  if (!respuesta.ok || cuerpo.ok !== true) {
    const mensaje =
      typeof cuerpo.error === "string"
        ? cuerpo.error
        : `El servidor respondió ${respuesta.status}. Intente nuevamente.`;
    const accion = typeof cuerpo.accion === "string" ? cuerpo.accion : null;

    throw new ErrorApi(respuesta.status, mensaje, accion);
  }

  return cuerpo as T;
}

/** Short haptic pulse: the plant is noisy and the hands are busy. */
function vibrar(): void {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;

  navigator.vibrate([100, 50, 100]);
}

/* -------------------------------------------------------------------------- */
/* Visual grouping                                                             */
/* -------------------------------------------------------------------------- */

type GrupoLinea = "Placares" | "Cocinas" | "Compartido";

const GRUPOS: { id: GrupoLinea; titulo: string; descripcion: string }[] = [
  { id: "Placares", titulo: "Placares", descripcion: "Línea de placares" },
  { id: "Cocinas", titulo: "Cocinas", descripcion: "Línea de cocinas" },
  { id: "Compartido", titulo: "Compartidos", descripcion: "Talleres de ambas líneas" },
];

const PALETA: Record<
  GrupoLinea,
  { punto: string; borde: string; fondo: string; seleccion: string }
> = {
  Placares: {
    punto: "bg-placares",
    borde: "border-placares/40",
    fondo: "bg-placares/10",
    seleccion: "ring-2 ring-placares",
  },
  Cocinas: {
    punto: "bg-cocinas",
    borde: "border-cocinas/40",
    fondo: "bg-cocinas/10",
    seleccion: "ring-2 ring-cocinas",
  },
  Compartido: {
    punto: "bg-compartidos",
    borde: "border-compartidos/40",
    fondo: "bg-compartidos/10",
    seleccion: "ring-2 ring-compartidos",
  },
};

function grupoDe(linea: LineaArea): GrupoLinea {
  if (linea === "Placares") return "Placares";
  if (linea === "Cocinas") return "Cocinas";
  return "Compartido";
}

/* -------------------------------------------------------------------------- */
/* Feedback                                                                    */
/* -------------------------------------------------------------------------- */

type Tono = "exito" | "error" | "aviso";

interface Feedback {
  tono: Tono;
  titulo: string;
  mensaje: string;
  detalle?: string | null;
}

const ESTILO_FEEDBACK: Record<Tono, string> = {
  exito: "border-proceso/40 bg-proceso/10 text-white",
  error: "border-alerta/50 bg-alerta/10 text-white",
  aviso: "border-pausa/40 bg-pausa/10 text-white",
};

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export default function TerminalFichado() {
  const searchParams = useSearchParams();
  const otParam = (searchParams.get("ot") ?? "").trim();

  const [ordenes, setOrdenes] = useState<OrdenConProgreso[]>([]);
  const [sectores, setSectores] = useState<Sector[]>([]);
  const [operarios, setOperarios] = useState<Operario[]>([]);

  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [refresco, setRefresco] = useState(0);

  const [otManual, setOtManual] = useState("");
  const [ignorarQr, setIgnorarQr] = useState(false);
  const [sectorId, setSectorId] = useState("");
  const [operario, setOperario] = useState("");
  const [motivo, setMotivo] = useState<MotivoPausa>(MOTIVOS_PAUSA[0]);
  const [observacion, setObservacion] = useState("");

  const [enviando, setEnviando] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  /*
   * One effect, one round trip set. `refresco` is a manual trigger: every
   * action bumps it so the screen re-reads the live state from the server
   * instead of guessing what the stage transition did.
   */
  useEffect(() => {
    let vigente = true;

    async function cargar() {
      try {
        const [resOrdenes, resSectores, resOperarios] = await Promise.all([
          pedirJson<RespuestaOrdenes>("/api/ordenes"),
          pedirJson<RespuestaSectores>("/api/sectores"),
          pedirJson<RespuestaOperarios>("/api/operarios"),
        ]);

        if (!vigente) return;

        setOrdenes(resOrdenes.ordenes);
        setSectores(resSectores.sectores);
        setOperarios(resOperarios.operarios);
        setErrorCarga(null);
      } catch (error) {
        if (!vigente) return;

        if (error instanceof ErrorApi && error.status === 401) {
          setErrorCarga("La sesión expiró. Vuelva a ingresar para fichar etapas.");
        } else {
          setErrorCarga(
            error instanceof Error
              ? error.message
              : "No se pudo conectar con el servidor de planta.",
          );
        }
      } finally {
        if (vigente) setCargando(false);
      }
    }

    void cargar();

    return () => {
      vigente = false;
    };
  }, [refresco]);

  function recargar() {
    setCargando(true);
    setRefresco((valor) => valor + 1);
  }

  /* ------------------------------------------------------------------ */
  /* Derived selection                                                   */
  /* ------------------------------------------------------------------ */

  const otEscaneada = useMemo(() => {
    if (!otParam || ignorarQr) return null;

    const buscado = otParam.toLowerCase();
    return (
      ordenes.find((ot) => ot.numero_ot.toLowerCase() === buscado) ??
      ordenes.find((ot) => String(ot.id) === otParam) ??
      null
    );
  }, [ordenes, otParam, ignorarQr]);

  const otSeleccionadaId = otEscaneada ? String(otEscaneada.id) : otManual;
  const ordenSeleccionada =
    ordenes.find((ot) => String(ot.id) === otSeleccionadaId) ?? null;
  const selectorBloqueado = otEscaneada !== null;

  const qrNoEncontrada =
    otParam !== "" && !ignorarQr && !cargando && otEscaneada === null;

  const sectoresOrden = useMemo(() => {
    if (!ordenSeleccionada) return [];

    const requeridos = new Set(ordenSeleccionada.sectores_requeridos);
    return sectores
      .filter((sector) => requeridos.has(sector.id))
      .sort((a, b) => {
        const propiaA = a.linea_area === ordenSeleccionada.linea_area ? 0 : 1;
        const propiaB = b.linea_area === ordenSeleccionada.linea_area ? 0 : 1;
        return (
          propiaA - propiaB || a.orden_flujo - b.orden_flujo || a.id - b.id
        );
      });
  }, [sectores, ordenSeleccionada]);

  const grupos = useMemo(
    () =>
      GRUPOS.map((grupo) => ({
        ...grupo,
        sectores: sectoresOrden.filter((sector) => grupoDe(sector.linea_area) === grupo.id),
      })).filter((grupo) => grupo.sectores.length > 0),
    [sectoresOrden],
  );

  const sectorSeleccionado =
    sectoresOrden.find((sector) => String(sector.id) === sectorId) ?? null;

  const etapaActiva = ordenSeleccionada?.etapa_activa ?? null;
  const sectorDeEtapa = etapaActiva
    ? (sectores.find((sector) => sector.id === etapaActiva.sector_id) ?? null)
    : null;

  const finalizados = useMemo(
    () => new Set(ordenSeleccionada?.progreso.finalizados_ids ?? []),
    [ordenSeleccionada],
  );

  const puedeIniciar =
    ordenSeleccionada !== null &&
    sectorSeleccionado !== null &&
    operario.trim().length > 0 &&
    enviando === null;

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */

  async function iniciar() {
    if (!ordenSeleccionada || !sectorSeleccionado) return;

    vibrar();
    setEnviando("iniciar");
    setFeedback(null);

    try {
      const datos = await pedirJson<RespuestaAccion>("/api/registros/iniciar", {
        method: "POST",
        body: JSON.stringify({
          ot_id: ordenSeleccionada.id,
          sector_id: sectorSeleccionado.id,
          operario_nombre: operario.trim(),
        }),
      });

      setFeedback({
        tono: "exito",
        titulo: "Etapa iniciada",
        mensaje: `${ordenSeleccionada.numero_ot} · ${sectorSeleccionado.nombre_sector} · ${datos.registro.operario_nombre}`,
      });
      setSectorId("");
      recargar();
    } catch (error) {
      const apiError = error instanceof ErrorApi ? error : null;
      setFeedback({
        tono: apiError?.status === 409 ? "aviso" : "error",
        titulo:
          apiError?.status === 409
            ? "La etapa no se puede iniciar"
            : "Error al iniciar la etapa",
        mensaje:
          error instanceof Error
            ? error.message
            : "Ocurrió un error inesperado al iniciar la etapa.",
        detalle: apiError?.accion,
      });
    } finally {
      setEnviando(null);
    }
  }

  async function pausar() {
    if (!etapaActiva) return;

    vibrar();
    setEnviando("pausar");
    setFeedback(null);

    try {
      await pedirJson<RespuestaAccion>("/api/registros/pausar", {
        method: "POST",
        body: JSON.stringify({
          registro_id: etapaActiva.id,
          motivo_pausa: motivo,
          observacion: observacion.trim() || null,
        }),
      });

      setFeedback({
        tono: "aviso",
        titulo: "Etapa pausada",
        mensaje: `${ordenSeleccionada?.numero_ot ?? "OT"} · ${sectorDeEtapa?.nombre_sector ?? "Sector"} · ${motivo}`,
      });
      setObservacion("");
      recargar();
    } catch (error) {
      const apiError = error instanceof ErrorApi ? error : null;
      setFeedback({
        tono: "error",
        titulo: "Error al pausar la etapa",
        mensaje:
          error instanceof Error
            ? error.message
            : "Ocurrió un error inesperado al pausar la etapa.",
        detalle: apiError?.accion,
      });
      if (apiError?.status === 409) recargar();
    } finally {
      setEnviando(null);
    }
  }

  async function reanudar() {
    if (!etapaActiva) return;

    vibrar();
    setEnviando("reanudar");
    setFeedback(null);

    try {
      await pedirJson<RespuestaAccion>("/api/registros/reanudar", {
        method: "POST",
        body: JSON.stringify({ registro_id: etapaActiva.id }),
      });

      setFeedback({
        tono: "exito",
        titulo: "Etapa reanudada",
        mensaje: `${ordenSeleccionada?.numero_ot ?? "OT"} · ${sectorDeEtapa?.nombre_sector ?? "Sector"}`,
      });
      setObservacion("");
      recargar();
    } catch (error) {
      const apiError = error instanceof ErrorApi ? error : null;
      setFeedback({
        tono: "error",
        titulo: "Error al reanudar la etapa",
        mensaje:
          error instanceof Error
            ? error.message
            : "Ocurrió un error inesperado al reanudar la etapa.",
        detalle: apiError?.accion,
      });
      if (apiError?.status === 409) recargar();
    } finally {
      setEnviando(null);
    }
  }

  async function finalizar() {
    if (!etapaActiva) return;

    const etiqueta = `${ordenSeleccionada?.numero_ot ?? `OT #${etapaActiva.ot_id}`} · ${
      sectorDeEtapa?.nombre_sector ?? `Sector #${etapaActiva.sector_id}`
    }`;

    if (!window.confirm(`¿Finalizar la etapa de ${etiqueta}?`)) return;

    vibrar();
    setEnviando("finalizar");
    setFeedback(null);

    try {
      const datos = await pedirJson<RespuestaAccion>("/api/registros/finalizar", {
        method: "POST",
        body: JSON.stringify({
          registro_id: etapaActiva.id,
          observacion: observacion.trim() || null,
        }),
      });

      setFeedback({
        tono: "exito",
        titulo: "Etapa finalizada",
        mensaje: `${etiqueta}${
          datos.registro.duracion_minutos !== null
            ? ` · ${formatearDuracion(datos.registro.duracion_minutos)} netos`
            : ""
        }`,
        detalle: datos.ot_auto_cerrada
          ? "La OT quedó FINALIZADA: se completaron todos sus sectores."
          : null,
      });
      setObservacion("");
      recargar();
    } catch (error) {
      const apiError = error instanceof ErrorApi ? error : null;
      setFeedback({
        tono: "error",
        titulo: "Error al finalizar la etapa",
        mensaje:
          error instanceof Error
            ? error.message
            : "Ocurrió un error inesperado al finalizar la etapa.",
        detalle: apiError?.accion,
      });
      if (apiError?.status === 409) recargar();
    } finally {
      setEnviando(null);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */

  if (cargando && ordenes.length === 0 && !errorCarga) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-24 animate-pulse rounded-lg border border-border bg-card" />
        <div className="h-72 animate-pulse rounded-lg border border-border bg-card" />
        <p className="text-sm text-white/50">Conectando con el servidor de planta…</p>
      </div>
    );
  }

  if (errorCarga && ordenes.length === 0) {
    return (
      <section
        role="alert"
        className="flex flex-col items-start gap-3 rounded-lg border border-alerta/40 bg-alerta/10 p-5"
      >
        <h1 className="text-lg font-semibold tracking-tight">Sin conexión con planta</h1>
        <p className="text-sm text-white/70">{errorCarga}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={recargar}
            className="min-h-[48px] touch-manipulation rounded-lg border border-border bg-card px-4 text-sm font-medium transition-transform active:scale-95"
          >
            Reintentar
          </button>
          <a
            href="/login"
            className="flex min-h-[48px] touch-manipulation items-center rounded-lg bg-cian px-4 text-sm font-semibold text-industrial transition-transform active:scale-95"
          >
            Ir a ingresar
          </a>
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Núcleo Operativo</h1>
          <p className="text-sm text-white/50">
            Fichado de etapas en planta. Seleccione OT, sector y operario.
          </p>
        </div>
        <button
          type="button"
          onClick={recargar}
          disabled={cargando}
          className="min-h-[48px] touch-manipulation rounded-lg border border-border bg-card px-4 text-sm font-medium transition-transform active:scale-95 disabled:opacity-60"
        >
          {cargando ? "Actualizando…" : "Actualizar"}
        </button>
      </header>

      {feedback ? (
        <div
          role="status"
          aria-live="polite"
          className={`rounded-lg border px-4 py-3 text-sm ${ESTILO_FEEDBACK[feedback.tono]}`}
        >
          <p className="font-semibold">{feedback.titulo}</p>
          <p className="mt-1 text-white/80">{feedback.mensaje}</p>
          {feedback.detalle ? (
            <p className="mt-1 text-xs text-white/60">{feedback.detalle}</p>
          ) : null}
        </div>
      ) : null}

      {qrNoEncontrada ? (
        <div
          role="alert"
          className="rounded-lg border border-pausa/40 bg-pausa/10 px-4 py-3 text-sm text-white/80"
        >
          La OT del QR (<span className="font-mono">{otParam}</span>) no figura entre
          las OTs activas. Seleccione una manualmente o verifique el código.
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-4">
          {/* Order selector */}
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="ot-terminal" className="text-sm font-medium">
                Orden de trabajo
              </label>
              {selectorBloqueado ? (
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-cian/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-cian ring-1 ring-cian/40">
                    OT fijada por QR
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setIgnorarQr(true);
                      setOtManual("");
                      setSectorId("");
                    }}
                    className="text-xs text-white/50 underline decoration-dotted underline-offset-2 hover:text-white"
                  >
                    usar otra
                  </button>
                </div>
              ) : null}
            </div>

            <select
              id="ot-terminal"
              value={otSeleccionadaId}
              disabled={selectorBloqueado || enviando !== null}
              onChange={(event) => {
                setOtManual(event.target.value);
                setSectorId("");
              }}
              className="mt-2 min-h-[56px] w-full touch-manipulation rounded-lg border border-border bg-industrial px-3 text-base text-white outline-none focus:border-cian disabled:opacity-70"
            >
              <option value="">Seleccione una OT…</option>
              {ordenes.map((ot) => (
                <option key={ot.id} value={String(ot.id)}>
                  {ot.numero_ot} · {ot.cliente} · {ot.linea_area}
                </option>
              ))}
            </select>

            {ordenSeleccionada ? (
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/60">
                  <span className="font-mono">{ordenSeleccionada.numero_ot}</span>
                  <span>{ordenSeleccionada.cliente}</span>
                  {ordenSeleccionada.modelo ? (
                    <span className="text-white/40">{ordenSeleccionada.modelo}</span>
                  ) : null}
                  <span className="font-mono">
                    {ordenSeleccionada.metros_lineales} m lineales
                  </span>
                  <span className="text-white/40">{ordenSeleccionada.estado_general}</span>
                </div>

                <div className="flex items-center gap-2">
                  <div
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-industrial"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={ordenSeleccionada.progreso.porcentaje}
                    aria-label="Progreso de la orden"
                  >
                    <div
                      className="h-full rounded-full bg-proceso transition-[width]"
                      style={{ width: `${ordenSeleccionada.progreso.porcentaje}%` }}
                    />
                  </div>
                  <span className="font-mono text-[11px] tabular-nums text-white/50">
                    {ordenSeleccionada.progreso.sectores_finalizados}/
                    {ordenSeleccionada.progreso.sectores_requeridos}
                  </span>
                </div>
              </div>
            ) : null}
          </section>

          {/* Sector selector, grouped by production line */}
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium">Sector</h2>
              {sectorSeleccionado ? (
                <span className="font-mono text-[11px] text-white/50">
                  {sectorSeleccionado.nombre_sector}
                </span>
              ) : null}
            </div>

            {ordenSeleccionada === null ? (
              <p className="mt-3 text-sm text-white/40">
                Seleccione una OT para ver los sectores de su línea.
              </p>
            ) : grupos.length === 0 ? (
              <p className="mt-3 text-sm text-white/40">
                Esta orden no tiene sectores configurados.
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-4">
                {grupos.map((grupo) => {
                  const paleta = PALETA[grupo.id];

                  return (
                    <div key={grupo.id}>
                      <div className="mb-2 flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={`h-2.5 w-2.5 rounded-full ${paleta.punto}`}
                        />
                        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60">
                          {grupo.titulo}
                        </h3>
                        <span className="text-[11px] text-white/30">
                          {grupo.descripcion}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {grupo.sectores.map((sector) => {
                          const terminado = finalizados.has(sector.id);
                          const bloqueo =
                            ordenSeleccionada.sectores_bloqueados[sector.id] ?? null;
                          const enCurso = etapaActiva?.sector_id === sector.id;
                          const activo = sectorId === String(sector.id);
                          const deshabilitado = terminado || bloqueo !== null;

                          return (
                            <button
                              key={sector.id}
                              type="button"
                              onClick={() => {
                                vibrar();
                                setSectorId(String(sector.id));
                              }}
                              disabled={deshabilitado || enviando !== null}
                              aria-pressed={activo}
                              title={bloqueo ?? undefined}
                              className={`flex min-h-[64px] touch-manipulation flex-col justify-between gap-1 rounded-lg border p-3 text-left transition-transform active:scale-95 disabled:cursor-not-allowed ${
                                activo ? paleta.seleccion : paleta.borde
                              } ${
                                activo ? paleta.fondo : "bg-industrial/60"
                              } ${
                                deshabilitado
                                  ? "opacity-45"
                                  : "hover:border-white/30"
                              }`}
                            >
                              <span className="flex w-full items-start justify-between gap-2">
                                <span className="text-sm font-medium leading-tight">
                                  {sector.nombre_corto || sector.nombre_sector}
                                </span>
                                <span className="shrink-0 font-mono text-[10px] text-white/30">
                                  {sector.orden_flujo}
                                </span>
                              </span>

                              <span className="flex w-full flex-wrap items-center gap-1.5">
                                {terminado ? (
                                  <span className="rounded-full bg-proceso/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-proceso ring-1 ring-proceso/40">
                                    Finalizado
                                  </span>
                                ) : bloqueo ? (
                                  <span className="line-clamp-2 text-[10px] leading-tight text-pausa/80">
                                    {bloqueo}
                                  </span>
                                ) : enCurso ? (
                                  <span className="flex items-center gap-1 rounded-full bg-proceso/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-proceso ring-1 ring-proceso/40">
                                    <span
                                      aria-hidden="true"
                                      className="h-1.5 w-1.5 animate-pulse rounded-full bg-proceso"
                                    />
                                    {etapaActiva?.estado_etapa === "Pausado"
                                      ? "Pausado"
                                      : "En curso"}
                                  </span>
                                ) : (
                                  <span className="font-mono text-[10px] text-white/30">
                                    {sector.estandar_min_por_metro.toFixed(1)} min/m
                                  </span>
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Right column: live status + operator + actions */}
        <div className="flex flex-col gap-4">
          {etapaActiva && ordenSeleccionada ? (
            <CronometroEnVivo
              registro={etapaActiva}
              numeroOt={ordenSeleccionada.numero_ot}
              sectorNombre={
                sectorDeEtapa?.nombre_sector ?? `Sector #${etapaActiva.sector_id}`
              }
              estandarMinPorMetro={
                sectorDeEtapa?.estandar_min_por_metro ?? ESTANDAR_POR_DEFECTO
              }
              metrosLineales={ordenSeleccionada.metros_lineales}
            />
          ) : (
            <section
              aria-label="Estado en vivo de la etapa"
              className="rounded-lg border border-dashed border-border bg-card/60 p-4"
            >
              <p className="text-sm font-medium text-white/70">Sin etapa abierta</p>
              <p className="mt-1 text-xs text-white/40">
                Al iniciar una etapa, el cronómetro y los controles en vivo aparecen
                acá.
              </p>
            </section>
          )}

          <section className="rounded-lg border border-border bg-card p-4">
            <label htmlFor="operario-terminal" className="text-sm font-medium">
              Operario
            </label>
            <input
              id="operario-terminal"
              list="operarios-terminal"
              value={operario}
              onChange={(event) => setOperario(event.target.value)}
              disabled={enviando !== null}
              autoComplete="off"
              autoCapitalize="words"
              placeholder="Nombre y apellido"
              className="mt-2 min-h-[56px] w-full touch-manipulation rounded-lg border border-border bg-industrial px-3 text-base text-white outline-none placeholder:text-white/30 focus:border-cian"
            />
            <datalist id="operarios-terminal">
              {operarios.map((op) => (
                <option key={op.id} value={op.nombre} />
              ))}
            </datalist>

            {sectorSeleccionado?.operarios_sugeridos ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {sectorSeleccionado.operarios_sugeridos
                  .split(",")
                  .map((nombre) => nombre.trim())
                  .filter(Boolean)
                  .map((nombre) => (
                    <button
                      key={nombre}
                      type="button"
                      onClick={() => setOperario(nombre)}
                      className="min-h-[36px] touch-manipulation rounded-full border border-border bg-industrial px-3 text-xs text-white/70 transition-transform active:scale-95"
                    >
                      {nombre}
                    </button>
                  ))}
              </div>
            ) : null}

            {etapaActiva?.estado_etapa === "En Proceso" ? (
              <div className="mt-4 flex flex-col gap-2">
                <label htmlFor="motivo-terminal" className="text-xs text-white/60">
                  Motivo de pausa
                </label>
                <select
                  id="motivo-terminal"
                  value={motivo}
                  onChange={(event) => setMotivo(event.target.value as MotivoPausa)}
                  disabled={enviando !== null}
                  className="min-h-[48px] touch-manipulation rounded-lg border border-border bg-industrial px-3 text-sm text-white outline-none focus:border-cian"
                >
                  {MOTIVOS_PAUSA.map((opcion) => (
                    <option key={opcion} value={opcion}>
                      {opcion}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <label htmlFor="observacion-terminal" className="mt-3 block text-xs text-white/60">
              Observación (opcional)
            </label>
            <textarea
              id="observacion-terminal"
              value={observacion}
              onChange={(event) => setObservacion(event.target.value)}
              disabled={enviando !== null}
              rows={2}
              maxLength={500}
              placeholder="Detalle de la pausa o del cierre"
              className="mt-1 w-full touch-manipulation rounded-lg border border-border bg-industrial px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-cian"
            />
          </section>

          <section className="flex flex-col gap-2">
            <button
              type="button"
              onClick={iniciar}
              disabled={!puedeIniciar}
              className="min-h-[56px] w-full touch-manipulation rounded-lg bg-proceso px-4 text-base font-semibold text-white transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {enviando === "iniciar" ? "Iniciando…" : "INICIAR"}
            </button>

            {etapaActiva ? (
              <>
                {etapaActiva.estado_etapa === "En Proceso" ? (
                  <button
                    type="button"
                    onClick={pausar}
                    disabled={enviando !== null}
                    className="min-h-[56px] w-full touch-manipulation rounded-lg bg-pausa px-4 text-base font-semibold text-industrial transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {enviando === "pausar" ? "Pausando…" : "PAUSAR"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={reanudar}
                    disabled={enviando !== null}
                    className="min-h-[56px] w-full touch-manipulation rounded-lg bg-cian px-4 text-base font-semibold text-industrial transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {enviando === "reanudar" ? "Reanudando…" : "REANUDAR"}
                  </button>
                )}

                <button
                  type="button"
                  onClick={finalizar}
                  disabled={enviando !== null}
                  className="min-h-[56px] w-full touch-manipulation rounded-lg bg-alerta px-4 text-base font-semibold text-white transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {enviando === "finalizar" ? "Finalizando…" : "FINALIZAR"}
                </button>
              </>
            ) : null}

            {!puedeIniciar && enviando === null ? (
              <p className="text-center text-[11px] leading-snug text-white/40">
                Para iniciar: elegí una OT, un sector habilitado y escribí el operario.
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
