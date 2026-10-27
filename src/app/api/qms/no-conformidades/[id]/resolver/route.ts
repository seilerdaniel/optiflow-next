import { connection } from "next/server";
import { resolverNoConformidad } from "@/lib/calidad-db";
import { entero, leerCuerpo, respuestaError, respuestaOk } from "@/lib/http";
import { requireGestion } from "@/lib/session-server";

/*
 * PATCH /api/qms/no-conformidades/:id/resolver → close a failure (Q5)
 *
 * Management only: resolving is the audit act that decides whether a defective
 * order keeps moving. The corrective action is mandatory, and resolving an
 * already closed failure is a 409 instead of a silent overwrite.
 */

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // See `/api/sectores`: outside the try so the prerender abort is not caught.
  await connection();

  try {
    const sesion = await requireGestion();

    const { id } = await params;
    const cuerpo = await leerCuerpo(request);

    const resultado = await resolverNoConformidad(
      entero(id, "id"),
      typeof cuerpo.accion_correctiva === "string" ? cuerpo.accion_correctiva : "",
      sesion.usuario.nombre,
    );

    return respuestaOk({ ...resultado });
  } catch (error) {
    return respuestaError(error);
  }
}
