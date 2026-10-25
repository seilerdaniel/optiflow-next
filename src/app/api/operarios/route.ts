import { connection } from "next/server";
import { respuestaError, respuestaOk } from "@/lib/http";
import { listarOperarios } from "@/lib/produccion-db";
import { requireSession } from "@/lib/session-server";

/*
 * GET /api/operarios
 *
 * Operator master. Active operators only by default (they feed the terminal);
 * `?todos=1` includes deactivated ones for the admin table. Each row carries
 * how many stages the operator has and how many are still open.
 */
export async function GET(request: Request) {
  // See `/api/sectores`: outside the try so the prerender abort is not caught.
  await connection();

  try {
    await requireSession();

    const { searchParams } = new URL(request.url);
    const todos = searchParams.get("todos") === "1" || searchParams.get("todos") === "true";

    const operarios = await listarOperarios(todos);

    return respuestaOk({
      total: operarios.length,
      incluye_inactivos: todos,
      operarios,
    });
  } catch (error) {
    return respuestaError(error);
  }
}
