import { connection } from "next/server";
import { marcarHerraje } from "@/lib/despiece-db";
import { booleano, entero, leerCuerpo, respuestaError, respuestaOk } from "@/lib/http";
import { requireSession } from "@/lib/session-server";

/*
 * PATCH /api/despiece/herraje/:id
 *
 * Marks hardware as delivered by the pañol (`{ entregado_por_panol: true }`) or
 * reverts the delivery. An empty body toggles.
 *
 * The pañol works on the floor with the same session as the terminal, so this is
 * not a management action. A concurrent re-import is serialised by `LOCK_OT`.
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

    const pedido = cuerpo.entregado_por_panol;
    const entregado = pedido === undefined || pedido === null || pedido === ""
      ? null
      : booleano(pedido);

    const resultado = await marcarHerraje(entero(id, "id"), entregado);

    return respuestaOk({ herraje: resultado });
  } catch (error) {
    return respuestaError(error);
  }
}
