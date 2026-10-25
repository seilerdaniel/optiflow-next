import { connection } from "next/server";
import {
  ApiError,
  booleano,
  decimal,
  enumOpcion,
  fecha,
  leerCuerpo,
  respuestaError,
  respuestaOk,
  textoOpcional,
  textoRequerido,
} from "@/lib/http";
import { ESTADOS_OT, LINEAS_OT } from "@/lib/produccion";
import { crearOrden, listarOrdenes, type FiltrosOrdenes } from "@/lib/produccion-db";
import { requireSession } from "@/lib/session-server";

/*
 * GET /api/ordenes
 *
 * Active orders (everything not `Finalizado`) with their progress, ready for
 * the terminal selector. The assembly uses the anti-N+1 batch: three queries
 * no matter how many orders come back, then an in-memory cross-reference.
 *
 * Filters: `?estado=`, `?linea_area=` (or `?linea=`), `?q=` (or `?buscar=`),
 * `?todos=1` to include finished orders.
 */
export async function GET(request: Request) {
  // See `/api/sectores`: outside the try so the prerender abort is not caught.
  await connection();

  try {
    await requireSession();

    const { searchParams } = new URL(request.url);

    const estadoCrudo = searchParams.get("estado") ?? searchParams.get("estado_general");
    const lineaCruda = searchParams.get("linea_area") ?? searchParams.get("linea");
    const textoCrudo = searchParams.get("q") ?? searchParams.get("buscar");
    const todos = searchParams.get("todos") === "1" || searchParams.get("todos") === "true";

    const filtros: FiltrosOrdenes = { todos };

    if (estadoCrudo) {
      filtros.estado = enumOpcion(estadoCrudo, ESTADOS_OT, "Estado general");
    }

    if (lineaCruda) {
      filtros.linea = enumOpcion(lineaCruda, LINEAS_OT, "Línea / área");
    }

    if (textoCrudo) {
      const texto = textoCrudo.trim();
      if (texto.length > 80) {
        throw new ApiError(400, 'El campo "Búsqueda" supera los 80 caracteres.');
      }
      if (texto) filtros.texto = texto;
    }

    const ordenes = await listarOrdenes(filtros);

    return respuestaOk({ total: ordenes.length, ordenes });
  } catch (error) {
    return respuestaError(error);
  }
}

/*
 * POST /api/ordenes
 *
 * Creates a work order from the office ("+ Nueva OT"). `numero_ot` is stored
 * uppercase and the line defaults to Placares, matching the legacy endpoint.
 * A duplicate number comes back as 409.
 */
export async function POST(request: Request) {
  // See `/api/sectores`: outside the try so the prerender abort is not caught.
  await connection();

  try {
    await requireSession();

    const cuerpo = await leerCuerpo(request);

    const ot = await crearOrden({
      numero_ot: textoRequerido(cuerpo.numero_ot, "Número de OT", { max: 40 }).toUpperCase(),
      cliente: textoRequerido(cuerpo.cliente, "Cliente", { max: 120 }),
      modelo: textoOpcional(cuerpo.modelo, "Modelo", { max: 80 }),
      linea_area:
        cuerpo.linea_area === undefined || cuerpo.linea_area === null || cuerpo.linea_area === ""
          ? "Placares"
          : enumOpcion(cuerpo.linea_area, LINEAS_OT, "Línea / área"),
      metros_lineales: decimal(cuerpo.metros_lineales, "Metros lineales", {
        min: 0,
        max: 1_000_000,
        requerido: true,
      }),
      fecha_prometida: fecha(cuerpo.fecha_prometida, "Fecha prometida"),
      requiere_vidrio: booleano(cuerpo.requiere_vidrio),
      requiere_lustre: booleano(cuerpo.requiere_lustre),
      requiere_herreria: booleano(cuerpo.requiere_herreria),
      requiere_especiales: booleano(cuerpo.requiere_especiales),
      estado_general: cuerpo.estado_general
        ? enumOpcion(cuerpo.estado_general, ESTADOS_OT, "Estado general")
        : "En Cola",
    });

    return respuestaOk({ ot }, 201);
  } catch (error) {
    return respuestaError(error);
  }
}
