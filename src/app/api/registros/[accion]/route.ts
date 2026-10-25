import {
  ApiError,
  entero,
  enumOpcion,
  leerCuerpo,
  respuestaError,
  respuestaOk,
  textoOpcional,
  textoRequerido,
} from "@/lib/http";
import { connection } from "next/server";
import { MOTIVOS_PAUSA } from "@/lib/produccion";
import {
  finalizarEtapa,
  iniciarEtapa,
  pausarEtapa,
  reanudarEtapa,
} from "@/lib/produccion-db";
import { requireSession } from "@/lib/session-server";

/*
 * POST /api/registros/:accion
 *
 * Stage actions of the plant terminal. The action travels in the path and the
 * identifiers in the body, which keeps one URL shape for the whole terminal:
 *
 *   iniciar   { ot_id, sector_id, operario_nombre }
 *   pausar    { registro_id, motivo_pausa, observacion? }
 *   reanudar  { registro_id, observacion? }
 *   finalizar { registro_id, observacion? }
 *
 * `registro_id` also accepts `id` for compatibility with clients that already
 * send the stage under that name.
 */

const ACCIONES = ["iniciar", "pausar", "reanudar", "finalizar"] as const;
type Accion = (typeof ACCIONES)[number];

function esAccion(valor: string): valor is Accion {
  return (ACCIONES as readonly string[]).includes(valor);
}

function idRegistro(cuerpo: Record<string, unknown>): number {
  return entero(cuerpo.registro_id ?? cuerpo.id, "registro_id");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accion: string }> },
) {
  // See `/api/sectores`: outside the try so the prerender abort is not caught.
  await connection();

  try {
    await requireSession();

    const { accion } = await params;
    if (!esAccion(accion)) {
      throw new ApiError(404, `Acción desconocida: "${accion}".`, {
        acciones_validas: ACCIONES,
      });
    }

    const cuerpo = await leerCuerpo(request);

    switch (accion) {
      case "iniciar": {
        const otId = entero(cuerpo.ot_id, "OT");
        const sectorId = entero(cuerpo.sector_id, "Sector");
        const operario = textoRequerido(cuerpo.operario_nombre, "Operario", { max: 80 });

        const registro = await iniciarEtapa({ otId, sectorId, operario });

        return respuestaOk({ registro }, 201);
      }

      case "pausar": {
        const registroId = idRegistro(cuerpo);
        const motivo = enumOpcion(cuerpo.motivo_pausa, MOTIVOS_PAUSA, "Motivo de pausa");
        const observacion = textoOpcional(cuerpo.observacion, "Observación", { max: 500 });

        const registro = await pausarEtapa({ registroId, motivo, observacion });

        return respuestaOk({ registro });
      }

      case "reanudar": {
        const registroId = idRegistro(cuerpo);
        const observacion = textoOpcional(cuerpo.observacion, "Observación", { max: 500 });

        const registro = await reanudarEtapa({ registroId, observacion });

        return respuestaOk({ registro });
      }

      case "finalizar": {
        const registroId = idRegistro(cuerpo);
        const observacion = textoOpcional(cuerpo.observacion, "Observación", { max: 500 });

        const resultado = await finalizarEtapa(registroId, observacion);

        return respuestaOk({
          registro: resultado.registro,
          ot: resultado.ot,
          ot_auto_cerrada: resultado.ot_auto_cerrada,
        });
      }
    }
  } catch (error) {
    return respuestaError(error);
  }
}
