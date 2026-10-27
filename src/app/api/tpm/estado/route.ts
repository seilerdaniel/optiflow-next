import { connection } from "next/server";
import { respuestaError, respuestaOk } from "@/lib/http";
import { estadoMantenimiento } from "@/lib/mantenimiento-db";
import { requireSession } from "@/lib/session-server";

/*
 * GET /api/tpm/estado → terminal view.
 *
 * Active machines only and no history: the tablet fetches this on every screen
 * load to warn when the selected sector has a machine past its target hours.
 */

export async function GET() {
  // See `/api/sectores`: outside the try so the prerender abort is not caught.
  await connection();

  try {
    await requireSession();

    const estado = await estadoMantenimiento();

    return respuestaOk({
      total: estado.maquinas.length,
      ...estado,
    });
  } catch (error) {
    return respuestaError(error);
  }
}
