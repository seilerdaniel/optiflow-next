import { connection } from "next/server";
import { obtenerDespiece } from "@/lib/despiece-db";
import { entero, respuestaError, respuestaOk } from "@/lib/http";
import { requireSession } from "@/lib/session-server";

/*
 * GET /api/despiece/:otId
 *
 * Full despiece of one work order: OT header, modules with their nested pieces
 * and hardware, the plate summary (D6) and the hardware sheet grouped by module.
 * Read-only, so any logged-in operator can consult it from the floor.
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ otId: string }> },
) {
  // See `/api/sectores`: outside the try so the prerender abort is not caught.
  await connection();

  try {
    await requireSession();

    const { otId } = await params;
    const despiece = await obtenerDespiece(entero(otId, "otId"));

    return respuestaOk({ ...despiece });
  } catch (error) {
    return respuestaError(error);
  }
}
