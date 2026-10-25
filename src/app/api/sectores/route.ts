import { connection } from "next/server";
import { respuestaError, respuestaOk } from "@/lib/http";
import { listarSectores } from "@/lib/produccion-db";
import { requireSession } from "@/lib/session-server";

/*
 * GET /api/sectores
 *
 * Active sectors only by default (they feed the terminal and the filters).
 * `?todos=1` includes deactivated ones for the admin table.
 * Ordered by line and then by `orden_flujo`, which is the visual sequence.
 */
export async function GET(request: Request) {
  // `connection()` sits OUTSIDE the try/catch on purpose: during prerendering
  // it throws the abort signal that marks this route as dynamic, and a catch
  // here would swallow it and turn it into a bogus 500.
  await connection();

  try {
    await requireSession();

    const { searchParams } = new URL(request.url);
    const todos = searchParams.get("todos") === "1" || searchParams.get("todos") === "true";

    const sectores = await listarSectores(todos);

    return respuestaOk({
      total: sectores.length,
      incluye_inactivos: todos,
      sectores,
    });
  } catch (error) {
    return respuestaError(error);
  }
}
