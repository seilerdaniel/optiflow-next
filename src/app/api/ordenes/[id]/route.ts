import { connection } from "next/server";
import {
  ApiError,
  booleano,
  decimal,
  entero,
  enumOpcion,
  fecha,
  leerCuerpo,
  respuestaError,
  respuestaOk,
  textoOpcional,
  textoRequerido,
} from "@/lib/http";
import { ESTADOS_OT, LINEAS_OT, type DetalleOrden } from "@/lib/produccion";
import {
  actualizarOrden,
  obtenerOrden,
  type CambiosOrden,
} from "@/lib/produccion-db";
import { requireSession } from "@/lib/session-server";

/*
 * GET   /api/ordenes/:id  → order detail (order + stage history + sectors)
 * PATCH /api/ordenes/:id  → edit the order attributes
 *
 * Both return the same envelope so the client can replace its whole state with
 * one `setState` after a save.
 */

async function detalleO404(id: number): Promise<DetalleOrden> {
  const detalle = await obtenerOrden(id);
  if (!detalle) throw new ApiError(404, `No existe la OT con id ${id}.`);
  return detalle;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // See `/api/sectores`: outside the try so the prerender abort is not caught.
  await connection();

  try {
    await requireSession();

    const { id } = await params;
    const detalle = await detalleO404(entero(id, "id"));

    return respuestaOk({ ...detalle });
  } catch (error) {
    return respuestaError(error);
  }
}

export async function PATCH(
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

    const cambios: CambiosOrden = {};

    if (cuerpo.numero_ot !== undefined) {
      cambios.numero_ot = textoRequerido(cuerpo.numero_ot, "Número de OT", { max: 40 }).toUpperCase();
    }
    if (cuerpo.cliente !== undefined) {
      cambios.cliente = textoRequerido(cuerpo.cliente, "Cliente", { max: 120 });
    }
    if (cuerpo.modelo !== undefined) {
      cambios.modelo = textoOpcional(cuerpo.modelo, "Modelo", { max: 80 });
    }
    if (cuerpo.linea_area !== undefined) {
      cambios.linea_area = enumOpcion(cuerpo.linea_area, LINEAS_OT, "Línea / área");
    }
    if (cuerpo.metros_lineales !== undefined) {
      cambios.metros_lineales = decimal(cuerpo.metros_lineales, "Metros lineales", {
        min: 0,
        max: 1_000_000,
        requerido: true,
      });
    }
    if (cuerpo.fecha_prometida !== undefined) {
      cambios.fecha_prometida = fecha(cuerpo.fecha_prometida, "Fecha prometida");
    }
    if (cuerpo.requiere_vidrio !== undefined) {
      cambios.requiere_vidrio = booleano(cuerpo.requiere_vidrio);
    }
    if (cuerpo.requiere_lustre !== undefined) {
      cambios.requiere_lustre = booleano(cuerpo.requiere_lustre);
    }
    if (cuerpo.requiere_herreria !== undefined) {
      cambios.requiere_herreria = booleano(cuerpo.requiere_herreria);
    }
    if (cuerpo.requiere_especiales !== undefined) {
      cambios.requiere_especiales = booleano(cuerpo.requiere_especiales);
    }
    if (cuerpo.estado_general !== undefined) {
      cambios.estado_general = enumOpcion(cuerpo.estado_general, ESTADOS_OT, "Estado general");
    }

    const detalle = await actualizarOrden(otId, cambios);

    return respuestaOk({ ...detalle });
  } catch (error) {
    return respuestaError(error);
  }
}
