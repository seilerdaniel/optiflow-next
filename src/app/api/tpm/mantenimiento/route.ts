import { connection } from "next/server";
import { leerCuerpo, respuestaError, respuestaOk } from "@/lib/http";
import { registrarMantenimiento } from "@/lib/mantenimiento-db";
import { requireGestion } from "@/lib/session-server";

/*
 * POST /api/tpm/mantenimiento → register a service (T3).
 *
 * Management only (T5): taking the snapshot that resets "hours since service"
 * changes when the machine will be serviced again, so it is not an operator
 * action.
 */

export async function POST(request: Request) {
  // See `/api/sectores`: outside the try so the prerender abort is not caught.
  await connection();

  try {
    await requireGestion();

    const cuerpo = await leerCuerpo(request, { maxBytes: 64_000 });
    const resultado = await registrarMantenimiento(cuerpo);

    return respuestaOk({ ...resultado }, 201);
  } catch (error) {
    return respuestaError(error);
  }
}
