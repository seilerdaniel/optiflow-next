import { connection } from "next/server";
import { marcarPieza } from "@/lib/despiece-db";
import { booleano, entero, leerCuerpo, respuestaError, respuestaOk } from "@/lib/http";
import { requireSession } from "@/lib/session-server";

/*
 * PATCH /api/despiece/pieza/:id
 *
 * Marks a piece as loaded on the truck (`{ cargado_en_flete: true }`) or unloads
 * it. An empty body toggles, which is what the Control de Flete tablet sends
 * when the operator taps the row: one URL, one decision.
 *
 * Any logged-in operator can do this; it is floor work, not a CAD edit.
 */

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // See `/api/sectores`: outside the try so the prerender abort is not caught.
  await connection();

  try {
    await requireSession();

    const { id } = await params;
    const cuerpo = await leerCuerpo(request, { maxBytes: 32_000 });

    const pedido = cuerpo.cargado_en_flete;
    const cargado = pedido === undefined || pedido === null || pedido === ""
      ? null
      : booleano(pedido);

    const resultado = await marcarPieza(entero(id, "id"), cargado);

    return respuestaOk({ pieza: resultado });
  } catch (error) {
    return respuestaError(error);
  }
}
