import { connection } from "next/server";
import {
  booleano,
  entero,
  leerCuerpo,
  respuestaError,
  respuestaOk,
  textoRequerido,
} from "@/lib/http";
import { actualizarOperario, type CambiosOperario } from "@/lib/produccion-db";
import { requireSession } from "@/lib/session-server";

/*
 * PUT /api/operarios/:id → rename and/or activate-deactivate.
 *
 * Partial update, like the legacy route: a field you omit is left untouched,
 * so `{ activo: false }` deactivates without renaming and `{ nombre }` renames
 * without touching the flag.
 *
 * Renaming regenerates `nombre_norm` on the server and propagates the spelling
 * to `registros_tiempos` in the same transaction (rule O4). The normalized key
 * is never accepted from the client: it is derived here, so a caller cannot
 * create two rows that look different but behave as duplicates.
 *
 * The response repeats the updated row plus `registros_actualizados`, which is
 * what the legacy backend returned and what a migration client expects.
 */

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // See `/api/sectores`: outside the try so the prerender abort is not caught.
  await connection();

  try {
    await requireSession();

    const { id } = await params;
    const operarioId = entero(id, "id");
    const cuerpo = await leerCuerpo(request);

    const cambios: CambiosOperario = {};

    if (cuerpo.nombre !== undefined) {
      cambios.nombre = textoRequerido(cuerpo.nombre, "Nombre del operario", { max: 80 });
    }
    if (cuerpo.activo !== undefined) {
      cambios.activo = booleano(cuerpo.activo);
    }

    const { operario, registros_actualizados } = await actualizarOperario(operarioId, cambios);

    return respuestaOk({ ...operario, registros_actualizados });
  } catch (error) {
    return respuestaError(error);
  }
}
