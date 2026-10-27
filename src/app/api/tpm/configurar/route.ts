import { connection } from "next/server";
import { leerCuerpo, respuestaError, respuestaOk } from "@/lib/http";
import { configurarMaquina } from "@/lib/mantenimiento-db";
import { requireGestion } from "@/lib/session-server";

/*
 * POST /api/tpm/configurar → create or edit a machine.
 *
 * Same endpoint for both operations, like the legacy backend: sending `id`
 * edits. Omitted optional fields keep their stored value, so a partial form
 * cannot deactivate a machine or wipe the baseline by accident.
 */

export async function POST(request: Request) {
  // See `/api/sectores`: outside the try so the prerender abort is not caught.
  await connection();

  try {
    await requireGestion();

    const cuerpo = await leerCuerpo(request, { maxBytes: 64_000 });
    const resultado = await configurarMaquina(cuerpo);

    return respuestaOk({ ...resultado }, resultado.creada ? 201 : 200);
  } catch (error) {
    return respuestaError(error);
  }
}
