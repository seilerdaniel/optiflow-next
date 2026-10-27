"use client";

import { useRef, useState } from "react";
import { CAMPO } from "@/components/ordenes/ui";
import { TIPOS_FALLA_QMS, type TipoFallaQMS } from "@/lib/calidad";

/*
 * "Reportar falla" dialog of the terminal.
 *
 * The photo is mandatory in the plant's workflow but optional at the API level,
 * so a tablet without a working camera can still record the failure. It is
 * compressed in the browser (max 1600 px, JPEG 0.75) because the route handler
 * accepts up to ~3.5 MB of base64 and the tablet uploads over plant Wi-Fi.
 *
 * Q4 happens on the server: pausing the stage, writing `eventos_pausa` and
 * stopping the order are a single transaction. The terminal only reloads.
 */

const MAX_LADO = 1600;
const CALIDAD_JPEG = 0.75;

function leerDataUrl(archivo: File): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(String(lector.result ?? ""));
    lector.onerror = () => rechazar(new Error("No se pudo leer la imagen."));
    lector.readAsDataURL(archivo);
  });
}

function cargarImagen(fuente: string): Promise<HTMLImageElement> {
  return new Promise((resolver, rechazar) => {
    const imagen = new Image();
    imagen.onload = () => resolver(imagen);
    imagen.onerror = () => rechazar(new Error("La imagen no es válida."));
    imagen.src = fuente;
  });
}

/** Shrinks the photo so the upload stays under the API cap. */
async function comprimirFoto(archivo: File): Promise<string> {
  const original = await leerDataUrl(archivo);
  const imagen = await cargarImagen(original);

  const escala = Math.min(1, MAX_LADO / Math.max(imagen.width, imagen.height));
  if (escala === 1 && original.length <= 2_500_000) return original;

  const lienzo = document.createElement("canvas");
  lienzo.width = Math.max(1, Math.round(imagen.width * escala));
  lienzo.height = Math.max(1, Math.round(imagen.height * escala));

  const contexto = lienzo.getContext("2d");
  if (!contexto) return original;

  contexto.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
  return lienzo.toDataURL("image/jpeg", CALIDAD_JPEG);
}

export default function ReportarFalla({
  otId,
  otNumero,
  sectorId,
  sectorNombre,
  operario,
  onReportada,
}: {
  otId: number;
  otNumero: string;
  sectorId: number;
  sectorNombre: string;
  operario: string | null;
  onReportada: () => void;
}) {
  const entradaFoto = useRef<HTMLInputElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState<TipoFallaQMS>(TIPOS_FALLA_QMS[0]);
  const [observacion, setObservacion] = useState("");
  const [foto, setFoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  function abrir() {
    setAbierto(true);
    setError(null);
    setExito(null);
  }

  function cerrar() {
    if (enviando) return;
    setAbierto(false);
    setFoto(null);
    setObservacion("");
    setTipo(TIPOS_FALLA_QMS[0]);
    if (entradaFoto.current) entradaFoto.current.value = "";
  }

  async function alElegirFoto(event: React.ChangeEvent<HTMLInputElement>) {
    const archivo = event.target.files?.[0];
    if (!archivo) return;

    setError(null);
    try {
      setFoto(await comprimirFoto(archivo));
    } catch {
      setFoto(null);
      setError("No se pudo procesar la foto. Intente tomarla de nuevo.");
    }
  }

  async function enviar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEnviando(true);
    setError(null);
    setExito(null);

    try {
      const respuesta = await fetch("/api/qms/no-conformidades", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          ot_id: otId,
          sector_id: sectorId,
          tipo_falla: tipo,
          observacion: observacion.trim() || null,
          operario_responsable: operario,
          foto_base64: foto,
          pausar_etapa: true,
        }),
      });

      const cuerpo = (await respuesta.json().catch(() => null)) as
        | { ok?: boolean; error?: string; etapa?: { pausada?: boolean } | null }
        | null;

      if (!respuesta.ok || cuerpo?.ok !== true) {
        throw new Error(
          cuerpo?.error ?? `El servidor respondió ${respuesta.status}. Intente nuevamente.`,
        );
      }

      setExito(
        cuerpo.etapa?.pausada
          ? "Falla registrada. La etapa quedó pausada y la OT detenida."
          : "Falla registrada en la orden.",
      );
      setFoto(null);
      setObservacion("");
      if (entradaFoto.current) entradaFoto.current.value = "";
      onReportada();
    } catch (fallo) {
      setError(
        fallo instanceof Error
          ? fallo.message
          : "No se pudo registrar la falla. Intente nuevamente.",
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
        className="min-h-[56px] w-full touch-manipulation rounded-lg border border-alerta/60 bg-alerta/15 px-4 text-base font-semibold text-alerta transition-transform active:scale-95"
      >
        REPORTAR FALLA
      </button>

      {abierto ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Reportar falla de calidad"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
        >
          <form
            onSubmit={enviar}
            className="flex max-h-[92vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-t-2xl border border-border bg-industrial p-5 sm:rounded-2xl"
          >
            <header className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold tracking-tight">Reportar falla</h2>
                <p className="mt-1 text-xs leading-relaxed text-white/45">
                  {otNumero} · {sectorNombre}. Al registrar la falla, la etapa abierta
                  se pausa y la OT pasa a Detenido.
                </p>
              </div>
              <button
                type="button"
                onClick={cerrar}
                disabled={enviando}
                className="rounded-lg border border-border px-2 py-1 text-xs text-white/60 disabled:opacity-50"
              >
                Cerrar
              </button>
            </header>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">
                Tipo de falla
              </span>
              <select
                value={tipo}
                onChange={(event) => setTipo(event.target.value as TipoFallaQMS)}
                disabled={enviando}
                className={CAMPO}
              >
                {TIPOS_FALLA_QMS.map((opcion) => (
                  <option key={opcion} value={opcion}>
                    {opcion}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">
                Foto de evidencia
              </span>
              <input
                ref={entradaFoto}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={alElegirFoto}
                disabled={enviando}
                className="min-h-[48px] w-full touch-manipulation rounded-lg border border-border bg-industrial px-3 py-2 text-sm text-white/70 file:mr-3 file:rounded-md file:border-0 file:bg-card file:px-3 file:py-1.5 file:text-xs file:text-white"
              />
            </label>

            {foto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={foto}
                alt="Vista previa de la evidencia"
                className="max-h-56 w-full rounded-lg border border-border object-contain"
              />
            ) : null}

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">
                Observación (opcional)
              </span>
              <textarea
                value={observacion}
                onChange={(event) => setObservacion(event.target.value)}
                disabled={enviando}
                maxLength={2_000}
                rows={3}
                placeholder="Qué se vio en la pieza o en la máquina"
                className={`${CAMPO} min-h-[80px] py-2`}
              />
            </label>

            {error ? (
              <p role="alert" className="rounded-lg border border-alerta/40 bg-alerta/10 px-3 py-2 text-xs leading-relaxed text-white/85">
                {error}
              </p>
            ) : null}

            {exito ? (
              <p role="status" className="rounded-lg border border-proceso/40 bg-proceso/10 px-3 py-2 text-xs leading-relaxed text-white/85">
                {exito}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={enviando}
              className="min-h-[52px] touch-manipulation rounded-lg bg-alerta px-4 text-sm font-semibold text-white transition-transform active:scale-95 disabled:opacity-60"
            >
              {enviando ? "Registrando…" : "Registrar no conformidad"}
            </button>
          </form>
        </div>
      ) : null}
    </>
  );
}
