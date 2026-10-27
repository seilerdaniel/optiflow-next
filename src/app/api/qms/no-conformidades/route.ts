import { connection } from "next/server";
import { listarNoConformidades, crearNoConformidad } from "@/lib/calidad-db";
import { leerCuerpo, respuestaError, respuestaOk } from "@/lib/http";
import { requireSession } from "@/lib/session-server";

/*
 * GET  /api/qms/no-conformidades → list + monthly summary
 * POST /api/qms/no-conformidades → register a failure (Q4)
 *
 * This POST is a route handler, NOT a Server Action, on purpose: the terminal
 * uploads a photo from the camera as base64 and Server Actions cap the body at
 * 1 MB. Route handlers have no such cap, so the legacy ~3.5 MB limit is
 * enforced here explicitly instead of relying on the framework.
 *
 * Registering does NOT require a management role: any operator on the floor
 * must be able to report a failure. Resolving it does (Q5).
 */

/** 3.5 MB photo + JSON envelope and base64 expansion. */
const MAX_CUERPO = 4_800_000;

export async function GET(request: Request) {
  // See `/api/sectores`: outside the try so the prerender abort is not caught.
  await connection();

  try {
    await requireSession();

    const { searchParams } = new URL(request.url);
    const listado = await listarNoConformidades({
      ot_id: searchParams.get("ot_id") ?? undefined,
      sector_id: searchParams.get("sector_id") ?? undefined,
      estado: searchParams.get("estado") ?? undefined,
      tipo_falla: searchParams.get("tipo_falla") ?? undefined,
      desde: searchParams.get("desde") ?? undefined,
      hasta: searchParams.get("hasta") ?? undefined,
      periodo: searchParams.get("periodo") ?? undefined,
      limite: searchParams.get("limite") ?? undefined,
    });

    return respuestaOk({
      total: listado.no_conformidades.length,
      no_conformidades: listado.no_conformidades,
      resumen: listado.resumen,
      filtros: listado.filtros,
    });
  } catch (error) {
    return respuestaError(error);
  }
}

export async function POST(request: Request) {
  // See `/api/sectores`: outside the try so the prerender abort is not caught.
  await connection();

  try {
    const sesion = await requireSession();
    const cuerpo = await leerCuerpo(request, { maxBytes: MAX_CUERPO });

    const resultado = await crearNoConformidad(cuerpo, sesion.usuario.nombre);

    return respuestaOk({ ...resultado }, 201);
  } catch (error) {
    return respuestaError(error);
  }
}
