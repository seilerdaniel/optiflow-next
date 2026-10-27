import { connection } from "next/server";
import { respuestaError, respuestaOk } from "@/lib/http";
import { listarMantenimiento } from "@/lib/mantenimiento-db";
import { requireSession } from "@/lib/session-server";

/*
 * GET /api/tpm → admin list.
 *
 * Every machine (inactive included, T4) with its live percentage, plus the
 * recent service history and the counters of the panel.
 */

export async function GET() {
  // See `/api/sectores`: outside the try so the prerender abort is not caught.
  await connection();

  try {
    await requireSession();

    const listado = await listarMantenimiento();

    return respuestaOk({
      total: listado.maquinas.length,
      ...listado,
    });
  } catch (error) {
    return respuestaError(error);
  }
}
