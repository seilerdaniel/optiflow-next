import { connection } from "next/server";
import { importarDespiece } from "@/lib/despiece-db";
import { entero, leerCuerpo, respuestaError, respuestaOk } from "@/lib/http";
import { requireGestion } from "@/lib/session-server";

/*
 * POST /api/despiece/:otId/importar
 *
 * Replace-all import of the CAM breakdown: modules -> pieces -> hardware. The
 * payload is the whole office sheet (~25 KB in practice), so it is read with an
 * explicit 1 MB cap instead of relying on a framework default.
 *
 * Management only: this rewrites the manufacturing instructions of an order.
 * The rules D1-D4 (replace, server-side bulto numbering, floor-state
 * preservation, lustre flag) live in `despiece-db`, together with the
 * `LOCK_OT` transaction.
 */

/** 1 MB: the legacy body limit, enough for thousands of piece rows. */
const MAX_CUERPO = 1_000_000;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ otId: string }> },
) {
  // See `/api/sectores`: outside the try so the prerender abort is not caught.
  await connection();

  try {
    await requireGestion();

    const { otId } = await params;
    const cuerpo = await leerCuerpo(request, { maxBytes: MAX_CUERPO });

    const despiece = await importarDespiece(entero(otId, "otId"), cuerpo.modulos);

    return respuestaOk({ ...despiece });
  } catch (error) {
    return respuestaError(error);
  }
}
