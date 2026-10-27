"use server";

import { revalidatePath } from "next/cache";
import { resolverNoConformidad as resolverNoConformidadDB } from "@/lib/calidad-db";
import { ApiError, entero, textoRequerido } from "@/lib/http";
import { requireGestion } from "@/lib/session-server";
import type { ResultadoAccion } from "@/lib/acciones";

/*
 * Server Actions of the quality panel.
 *
 * Only resolution lives here: reporting needs the camera photo and goes through
 * the route handler (Server Actions cap the body at 1 MB). The business rules
 * stay in `calidad-db`, shared with the REST endpoints — this file is a thin
 * adapter that authorises, revalidates and turns errors into a message.
 */

const ACCION = "Acción correctiva";
const ACCION_MAX = 2_000;

function mensajeDeError(error: unknown): string {
  if (error instanceof ApiError) {
    const accion = error.detalle?.accion;
    return typeof accion === "string" ? `${error.message} ${accion}` : error.message;
  }

  console.error("[calidad] unexpected error:", error);
  return "No se pudo completar la operación. Intente nuevamente.";
}

/**
 * Closes a non-conformity (Q5).
 *
 * Takes arguments instead of `FormData` so the client can await it inside a
 * transition and close the panel only after the server confirmed the write.
 */
export async function resolverNoConformidad(
  id: number,
  accionCorrectiva: string,
): Promise<ResultadoAccion> {
  try {
    const sesion = await requireGestion();

    const { no_conformidad } = await resolverNoConformidadDB(
      entero(id, "id"),
      textoRequerido(accionCorrectiva, ACCION, { max: ACCION_MAX }),
      sesion.usuario.nombre,
    );

    revalidatePath("/calidad");
    revalidatePath("/");

    return {
      ok: true,
      mensaje: `${no_conformidad.numero_ot} · ${no_conformidad.tipo_falla} quedó resuelta.`,
    };
  } catch (error) {
    return { ok: false, mensaje: mensajeDeError(error) };
  }
}
