import { connection } from "next/server";
import { ApiError, decimal, entero, leerCuerpo, respuestaError, respuestaOk, textoOpcional, textoRequerido } from "@/lib/http";
import {
  reemplazarMateriales,
  type MaterialEntrada,
} from "@/lib/produccion-db";
import { requireSession } from "@/lib/session-server";

/*
 * PUT /api/ordenes/:id/materiales
 *
 * Full replace of an order's material list. The body carries the WHOLE list:
 *
 *   { "materiales": [
 *       { "id": 12, "cantidad_consumida": 3.5 },      // existing row: inherits the rest
 *       { "material_nombre": "MDF 18mm", "cantidad_placas": 4 }  // new row
 *   ] }
 *
 * Rows omitted from the array are deleted, which is why the UI always sends
 * every existing row back. Validation of the consumed ≤ required invariant
 * happens inside the transaction, after merging each row with its stored value.
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
    const otId = entero(id, "id");

    const cuerpo = await leerCuerpo(request);
    const crudos = cuerpo.materiales;

    if (!Array.isArray(crudos)) {
      throw new ApiError(400, 'El campo "materiales" debe ser una lista.');
    }

    const entradas: MaterialEntrada[] = crudos.map((crudo, indice) => {
      const posicion = indice + 1;

      if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) {
        throw new ApiError(400, `Material #${posicion}: formato inválido.`);
      }

      const fila = crudo as Record<string, unknown>;
      const entrada: MaterialEntrada = {
        id:
          fila.id === undefined || fila.id === null
            ? null
            : entero(fila.id, `Material #${posicion} (id)`),
      };

      if (fila.material_nombre !== undefined) {
        entrada.material_nombre = textoRequerido(
          fila.material_nombre,
          `Material #${posicion} (nombre)`,
          { max: 140 },
        );
      }
      if (fila.cantidad_placas !== undefined) {
        entrada.cantidad_placas = decimal(
          fila.cantidad_placas,
          `Material #${posicion} (cantidad de placas)`,
          { min: 0.01, max: 100_000, requerido: true },
        );
      }
      if (fila.cantidad_consumida !== undefined) {
        entrada.cantidad_consumida = decimal(
          fila.cantidad_consumida,
          `Material #${posicion} (placas consumidas)`,
          { min: 0, max: 100_000 },
        );
      }
      if (fila.observaciones !== undefined) {
        entrada.observaciones = textoOpcional(
          fila.observaciones,
          `Material #${posicion} (observaciones)`,
          { max: 300 },
        );
      }

      if (entrada.id === null) {
        if (entrada.material_nombre === undefined || entrada.cantidad_placas === undefined) {
          throw new ApiError(
            400,
            `Material #${posicion}: una fila nueva necesita nombre y cantidad de placas.`,
          );
        }
      }

      return entrada;
    });

    const resultado = await reemplazarMateriales(otId, entradas);

    return respuestaOk({
      total: resultado.materiales.length,
      materiales: resultado.materiales,
      resumen_materiales: resultado.resumen_materiales,
    });
  } catch (error) {
    return respuestaError(error);
  }
}
