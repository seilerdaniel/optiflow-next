import { connection } from "next/server";
import {
  booleano,
  leerCuerpo,
  respuestaError,
  respuestaOk,
  textoRequerido,
} from "@/lib/http";
import { crearOperario, listarOperarios } from "@/lib/produccion-db";
import { requireSession } from "@/lib/session-server";

/*
 * GET  /api/operarios → master list (active only unless `?todos=1`)
 * POST /api/operarios → create an operator
 *
 * Operator master. Active operators only by default (they feed the terminal);
 * `?todos=1` includes deactivated ones for the admin table. Each row carries
 * how many stages the operator has and how many are still open.
 *
 * Same surface as the legacy Express backend: list + create here, rename and
 * activate/deactivate in `[id]`. Both handlers delegate the business rules to
 * `produccion-db`, which is also what the Server Actions call.
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

export async function POST(request: Request) {
  // See `/api/sectores`: outside the try so the prerender abort is not caught.
  await connection();

  try {
    await requireSession();

    const cuerpo = await leerCuerpo(request);

    const nombre = textoRequerido(cuerpo.nombre, "Nombre del operario", { max: 80 });
    const activo = booleano(cuerpo.activo, true);

    const operario = await crearOperario(nombre, activo);

    return respuestaOk({ ...operario }, 201);
  } catch (error) {
    return respuestaError(error);
  }
}
