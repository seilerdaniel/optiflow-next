"use client";

import { useState } from "react";
import { ErrorApi, pedirJson } from "@/lib/api-client";
import {
  type MaterialOT,
  type OrdenConProgreso,
  type ResumenMateriales,
} from "@/lib/produccion";
import { CAMPO } from "./ui";

/*
 * Materials & plates tab.
 *
 * The endpoint is a FULL REPLACE (`PUT /api/ordenes/:id/materiales`), so the
 * screen always sends every stored row back; rows with `id` inherit their name
 * and required plates on the server and only carry the new consumption. New
 * rows travel without `id` and must bring name + plates.
 */

interface NuevoMaterial {
  nombre: string;
  placas: number;
  observaciones: string | null;
}

interface RespuestaMateriales {
  ok: true;
  total: number;
  materiales: MaterialOT[];
  resumen_materiales: ResumenMateriales;
}

export default function PanelMateriales({
  ot,
  onGuardado,
}: {
  ot: OrdenConProgreso;
  onGuardado: (materiales: MaterialOT[], resumen: ResumenMateriales) => void;
}) {
  const [draft, setDraft] = useState<Record<number, number>>({});
  const [nuevos, setNuevos] = useState<NuevoMaterial[]>([]);
  const [eliminados, setEliminados] = useState<number[]>([]);
  const [nuevo, setNuevo] = useState({ nombre: "", placas: "", observaciones: "" });
  const [errorNuevo, setErrorNuevo] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const filas = [
    ...ot.materiales
      .filter((material) => !eliminados.includes(material.id))
      .map((material) => ({
        clave: `material-${material.id}`,
        id: material.id,
        nombre: material.material_nombre,
        requeridas: material.cantidad_placas,
        consumidas: draft[material.id] ?? material.cantidad_consumida,
        observaciones: material.observaciones,
      })),
    ...nuevos.map((material, indice) => ({
      clave: `nuevo-${indice}`,
      id: null,
      nombre: material.nombre,
      requeridas: material.placas,
      consumidas: 0,
      observaciones: material.observaciones,
    })),
  ];

  const requeridas = Math.round(filas.reduce((total, fila) => total + fila.requeridas, 0) * 100) / 100;
  const consumidas = Math.round(filas.reduce((total, fila) => total + fila.consumidas, 0) * 100) / 100;
  const restantes = Math.max(0, Math.round((requeridas - consumidas) * 100) / 100);
  const porcentaje = requeridas > 0 ? Math.round((consumidas / requeridas) * 100) : 0;

  const hayCambios =
    Object.keys(draft).length > 0 || nuevos.length > 0 || eliminados.length > 0;

  function fijarConsumo(id: number, requeridasFila: number, valor: string) {
    const numero = Number(valor);
    const acotado = Number.isFinite(numero)
      ? Math.min(requeridasFila, Math.max(0, numero))
      : 0;

    setDraft((previo) => ({ ...previo, [id]: acotado }));
    setOk(null);
  }

  function agregar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nombre = nuevo.nombre.trim();
    const placas = Number(nuevo.placas);

    if (!nombre) {
      setErrorNuevo("Indique el nombre del material.");
      return;
    }
    if (!Number.isFinite(placas) || placas <= 0) {
      setErrorNuevo("La cantidad de placas debe ser mayor que cero.");
      return;
    }

    setNuevos((previo) => [
      ...previo,
      {
        nombre,
        placas: Math.round(placas * 100) / 100,
        observaciones: nuevo.observaciones.trim() || null,
      },
    ]);
    setNuevo({ nombre: "", placas: "", observaciones: "" });
    setErrorNuevo(null);
    setOk(null);
  }

  async function guardar() {
    if (guardando || !hayCambios) return;

    setGuardando(true);
    setError(null);
    setOk(null);

    try {
      const respuesta = await pedirJson<RespuestaMateriales>(
        `/api/ordenes/${ot.id}/materiales`,
        {
          method: "PUT",
          body: JSON.stringify({
            materiales: [
              ...ot.materiales
                .filter((material) => !eliminados.includes(material.id))
                .map((material) => ({
                  id: material.id,
                  cantidad_consumida: draft[material.id] ?? material.cantidad_consumida,
                })),
              ...nuevos.map((material) => ({
                material_nombre: material.nombre,
                cantidad_placas: material.placas,
                cantidad_consumida: 0,
                observaciones: material.observaciones,
              })),
            ],
          }),
        },
      );

      onGuardado(respuesta.materiales, respuesta.resumen_materiales);
      setDraft({});
      setNuevos([]);
      setEliminados([]);
      setOk("Consumo de placas actualizado.");
    } catch (fallo) {
      if (fallo instanceof ErrorApi) {
        setError(fallo.accion ? `${fallo.message} ${fallo.accion}` : fallo.message);
      } else {
        setError("No se pudo guardar el consumo. Intente nuevamente.");
      }
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/60">
            Materiales y placas
          </h2>
          <p className="mt-1 text-xs text-white/40">
            Consumo real contra lo requerido. Los cambios se guardan en bloque.
          </p>
        </div>
        <button
          type="button"
          onClick={guardar}
          disabled={guardando || !hayCambios}
          className="min-h-[44px] rounded-lg bg-cian px-4 text-sm font-semibold text-industrial transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {guardando ? "Guardando…" : "Guardar consumo"}
        </button>
      </header>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-border/70 bg-industrial/60 p-3">
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">
            Requeridas
          </dt>
          <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
            {requeridas}
          </dd>
        </div>
        <div className="rounded-lg border border-border/70 bg-industrial/60 p-3">
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">
            Consumidas
          </dt>
          <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-cian">
            {consumidas}
          </dd>
        </div>
        <div className="rounded-lg border border-border/70 bg-industrial/60 p-3">
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">
            Restantes
          </dt>
          <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
            {restantes}
          </dd>
        </div>
        <div className="rounded-lg border border-border/70 bg-industrial/60 p-3">
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">
            Consumo
          </dt>
          <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
            {porcentaje}%
          </dd>
        </div>
      </dl>

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

      {filas.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-white/40">
          Esta OT todavía no tiene materiales cargados.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {filas.map((fila) => {
            const porcentajeFila =
              fila.requeridas > 0
                ? Math.min(100, Math.round((fila.consumidas / fila.requeridas) * 100))
                : 0;

            return (
              <li
                key={fila.clave}
                className="rounded-lg border border-border bg-industrial/40 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{fila.nombre}</p>
                    <p className="mt-0.5 font-mono text-[11px] tabular-nums text-white/45">
                      {fila.consumidas} / {fila.requeridas} placas · faltan{" "}
                      {Math.max(0, Math.round((fila.requeridas - fila.consumidas) * 100) / 100)}
                    </p>
                    {fila.observaciones ? (
                      <p className="mt-1 text-xs text-white/35">{fila.observaciones}</p>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2">
                      <span className="sr-only">Placas consumidas de {fila.nombre}</span>
                      <input
                        type="number"
                        min="0"
                        max={fila.requeridas}
                        step="0.5"
                        inputMode="decimal"
                        value={fila.consumidas}
                        disabled={fila.id === null || guardando}
                        onChange={(event) =>
                          fila.id !== null &&
                          fijarConsumo(fila.id, fila.requeridas, event.target.value)
                        }
                        className={`${CAMPO} w-24 text-right font-mono`}
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => {
                        const idFila = fila.id;
                        if (idFila !== null) {
                          setEliminados((previo) => [...previo, idFila]);
                        } else {
                          const indice = Number(fila.clave.replace("nuevo-", ""));
                          setNuevos((previo) => previo.filter((_, i) => i !== indice));
                        }
                        setOk(null);
                      }}
                      className="min-h-[38px] rounded-lg border border-border px-2 text-xs text-white/50 transition-colors hover:border-alerta/50 hover:text-alerta"
                    >
                      Quitar
                    </button>
                  </div>
                </div>

                <div
                  className="mt-2 h-2 overflow-hidden rounded-full bg-industrial"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={porcentajeFila}
                  aria-label={`Consumo de ${fila.nombre}`}
                >
                  <div
                    className={`h-full rounded-full transition-[width] ${
                      porcentajeFila >= 100 ? "bg-proceso" : "bg-cian"
                    }`}
                    style={{ width: `${porcentajeFila}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form
        onSubmit={agregar}
        className="grid gap-2 rounded-lg border border-dashed border-border p-3 sm:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)_auto]"
      >
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
            Material
          </span>
          <input
            maxLength={140}
            value={nuevo.nombre}
            onChange={(event) => setNuevo((previo) => ({ ...previo, nombre: event.target.value }))}
            placeholder="Aglomerado 18mm"
            className={CAMPO}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
            Placas
          </span>
          <input
            type="number"
            min="0.01"
            step="0.5"
            inputMode="decimal"
            value={nuevo.placas}
            onChange={(event) => setNuevo((previo) => ({ ...previo, placas: event.target.value }))}
            placeholder="0"
            className={`${CAMPO} font-mono`}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
            Observaciones
          </span>
          <input
            maxLength={300}
            value={nuevo.observaciones}
            onChange={(event) =>
              setNuevo((previo) => ({ ...previo, observaciones: event.target.value }))
            }
            placeholder="Opcional"
            className={CAMPO}
          />
        </label>

        <div className="flex items-end">
          <button
            type="submit"
            className="min-h-[44px] w-full rounded-lg border border-cian/50 bg-cian/10 px-4 text-sm font-medium text-cian transition-colors hover:bg-cian/20 sm:w-auto"
          >
            + Agregar
          </button>
        </div>

        {errorNuevo ? (
          <p className="text-xs text-alerta sm:col-span-4">{errorNuevo}</p>
        ) : null}
      </form>
    </div>
  );
}
