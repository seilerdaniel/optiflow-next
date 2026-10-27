"use server";

import { revalidatePath } from "next/cache";
import type { ResultadoAccion } from "@/lib/acciones";
import { ApiError } from "@/lib/http";
import { configurarMaquina, registrarMantenimiento } from "@/lib/mantenimiento-db";
import type { EntradaMaquina, EntradaService } from "@/lib/mantenimiento";
import { requireGestion } from "@/lib/session-server";

/*
 * Server Actions of the maintenance panel.
 *
 * Both writes require a management role (T5). Validation and snapshot logic
 * live in `mantenimiento-db`, shared with `/api/tpm/*`; here we only adapt the
 * result to a message and revalidate the screens that show the counters.
 */

function mensajeDeError(error: unknown): string {
  if (error instanceof ApiError) {
    const accion = error.detalle?.accion;
    return typeof accion === "string" ? `${error.message} ${accion}` : error.message;
  }

  console.error("[mantenimiento] unexpected error:", error);
  return "No se pudo completar la operación. Intente nuevamente.";
}

/** T3: snapshots the sector's net hours and records the service. */
export async function registrarService(entrada: EntradaService): Promise<ResultadoAccion> {
  try {
    await requireGestion();

    const resultado = await registrarMantenimiento({
      maquina_tpm_id: entrada.maquina_tpm_id,
      tecnico_operario: entrada.tecnico_operario,
      observaciones: entrada.observaciones,
    });

    revalidatePath("/mantenimiento");
    revalidatePath("/");

    return {
      ok: true,
      mensaje: `Service registrado en "${resultado.maquina.nombre_maquina}". El contador vuelve a 0 h desde el último service; las horas acumuladas del sector (${resultado.horas_acumuladas_al_service} h) quedan en el historial.`,
    };
  } catch (error) {
    return { ok: false, mensaje: mensajeDeError(error) };
  }
}

/** Creates or edits a machine; omitted optional fields keep their value. */
export async function guardarMaquina(entrada: EntradaMaquina): Promise<ResultadoAccion> {
  try {
    await requireGestion();

    const resultado = await configurarMaquina({
      id: entrada.id,
      sector_id: entrada.sector_id,
      nombre_maquina: entrada.nombre_maquina,
      tarea_mantenimiento: entrada.tarea_mantenimiento,
      intervalo_horas_target: entrada.intervalo_horas_target,
      horas_ultimo_mantenimiento: entrada.horas_ultimo_mantenimiento,
      activo: entrada.activo,
    });

    revalidatePath("/mantenimiento");
    revalidatePath("/");

    return {
      ok: true,
      mensaje: resultado.creada
        ? "Máquina agregada al plan de mantenimiento."
        : "Los datos de la máquina se actualizaron.",
    };
  } catch (error) {
    return { ok: false, mensaje: mensajeDeError(error) };
  }
}
