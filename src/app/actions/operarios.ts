"use server";

import { revalidatePath } from "next/cache";
import type { ResultadoAccion } from "@/components/operarios/tipos";
import { ApiError, entero, textoRequerido } from "@/lib/http";
import { actualizarOperario, crearOperario as crearOperarioDB, type CambiosOperario } from "@/lib/produccion-db";
import { requireSession } from "@/lib/session-server";

/*
 * Server Actions of the operator master.
 *
 * Every action re-checks the session: a Server Action is a public endpoint, so
 * rendering the form only on an authenticated page is not authorisation.
 *
 * The business rules (O1/O2 normalized key, O3 deactivation keeps history, O4
 * rename propagates to `registros_tiempos`) live in `produccion-db`, NOT here.
 * The REST endpoints `/api/operarios` and `/api/operarios/:id` call the same
 * functions, so the two entry points cannot drift apart. This module only
 * adapts them to what a form needs: a `{ ok, mensaje }` result that never
 * throws, plus cache revalidation.
 */

const NOMBRE_CAJA = "Nombre del operario";
const NOMBRE_MAX = 80;

/** Maps a thrown value to an operator-facing message. Never leaks SQL. */
function mensajeDeError(error: unknown): string {
  if (error instanceof ApiError) {
    const accion = error.detalle?.accion;
    return typeof accion === "string" ? `${error.message} ${accion}` : error.message;
  }

  // Concurrent insert of the same normalized name: the unique index won.
  if (typeof error === "object" && error !== null && "code" in error) {
    if ((error as { code?: string }).code === "23505") {
      return "Ya existe un operario con ese nombre (las tildes y mayúsculas no cuentan como diferencia).";
    }
  }

  console.error("[operarios] unexpected error:", error);
  return "No se pudo completar la operación. Intente nuevamente.";
}

/**
 * Creates an operator in the master. Used from `<form action>` through
 * `useActionState`, so the signature is `(prevState, formData)`.
 */
export async function crearOperario(
  _estadoPrevio: ResultadoAccion,
  formData: FormData,
): Promise<ResultadoAccion> {
  try {
    await requireSession();

    const nombre = textoRequerido(formData.get("nombre"), NOMBRE_CAJA, { max: NOMBRE_MAX });
    const operario = await crearOperarioDB(nombre);

    revalidatePath("/operarios");

    return { ok: true, mensaje: `"${operario.nombre}" se agregó al maestro de operarios.` };
  } catch (error) {
    return { ok: false, mensaje: mensajeDeError(error) };
  }
}

/**
 * Activates or deactivates an operator.
 *
 * Rule O3: a deactivated operator cannot start new stages, but the whole
 * history stays intact and re-activating is enough to use them again. That is
 * why the action only flips the flag instead of deleting the row.
 */
export async function toggleOperario(id: number, activo: boolean): Promise<ResultadoAccion> {
  try {
    await requireSession();

    const { operario } = await actualizarOperario(entero(id, "id"), { activo: !activo });

    revalidatePath("/operarios");

    return {
      ok: true,
      mensaje: operario.activo
        ? `"${operario.nombre}" quedó activo y ya puede fichar etapas.`
        : `"${operario.nombre}" quedó inactivo: su historial se conserva.`,
    };
  } catch (error) {
    return { ok: false, mensaje: mensajeDeError(error) };
  }
}

/**
 * Renames an operator, regenerating `nombre_norm` and propagating the spelling
 * to the stage history (rule O4) in one transaction.
 */
export async function renombrarOperario(id: number, nombre: string): Promise<ResultadoAccion> {
  try {
    await requireSession();

    const cambios: CambiosOperario = {
      nombre: textoRequerido(nombre, NOMBRE_CAJA, { max: NOMBRE_MAX }),
    };
    const { operario, nombre_anterior, registros_actualizados } = await actualizarOperario(
      entero(id, "id"),
      cambios,
    );

    revalidatePath("/operarios");

    if (nombre_anterior === operario.nombre) {
      return { ok: true, mensaje: `El nombre de "${operario.nombre}" no cambió.` };
    }

    return {
      ok: true,
      mensaje:
        registros_actualizados > 0
          ? `"${nombre_anterior}" ahora es "${operario.nombre}". Se corrigieron ${registros_actualizados} registro(s) de planta.`
          : `"${nombre_anterior}" ahora es "${operario.nombre}".`,
    };
  } catch (error) {
    return { ok: false, mensaje: mensajeDeError(error) };
  }
}
