"use server";

import { revalidatePath } from "next/cache";
import type { ResultadoAccion } from "@/components/operarios/tipos";
import { query, withTransaction } from "@/lib/db";
import { ApiError, entero, textoRequerido } from "@/lib/http";
import { ahoraUTC, claveNormalizada } from "@/lib/produccion";
import { requireSession } from "@/lib/session-server";

/*
 * Server Actions of the operator master.
 *
 * Every action re-checks the session: a Server Action is a public endpoint, so
 * rendering the form only on an authenticated page is not authorisation.
 *
 * Business rule O1/O2 (legacy `server/routes/operarios.js`): the display name
 * is what the plant types, but uniqueness lives in `nombre_norm` (lowercase,
 * no accents, collapsed spaces). "Pérez" and "Perez" therefore collide instead
 * of creating two operators with split metrics.
 *
 * Rule O4: renaming propagates to `registros_tiempos.operario_nombre` in the
 * same transaction. The historical rows are keyed by NAME, not by id, so a
 * rename that only touched the master would split every per-operator metric
 * into two people.
 */

const NOMBRE_CAJA = "Nombre del operario";
const NOMBRE_MAX = 80;

/** Maps a thrown value to an operator-facing message. Never leaks SQL. */
function mensajeDeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;

  // Concurrent insert of the same normalized name: the unique index won.
  if (typeof error === "object" && error !== null && "code" in error) {
    if ((error as { code?: string }).code === "23505") {
      return "Ya existe un operario con ese nombre (las tildes y mayúsculas no cuentan como diferencia).";
    }
  }

  console.error("[operarios] unexpected error:", error);
  return "No se pudo completar la operación. Intente nuevamente.";
}

/**
 * Creates an operator in the master. Used from `<form action>` through
 * `useActionState`, so the signature is `(prevState, formData)`.
 */
export async function crearOperario(
  _estadoPrevio: ResultadoAccion,
  formData: FormData,
): Promise<ResultadoAccion> {
  try {
    await requireSession();

    const nombre = textoRequerido(formData.get("nombre"), NOMBRE_CAJA, { max: NOMBRE_MAX });
    const nombreNorm = claveNormalizada(nombre);

    const existente = await query<{ id: number; activo: number }>(
      `SELECT id, activo FROM operarios WHERE nombre_norm = $1;`,
      [nombreNorm],
    );

    const fila = existente.rows[0];
    if (fila) {
      return {
        ok: false,
        mensaje:
          `El operario "${nombre}" ya está registrado` +
          (fila.activo ? "." : " y está desactivado: reactívelo desde la lista."),
      };
    }

    await query(
      `INSERT INTO operarios (nombre, nombre_norm, activo, fecha_creacion)
       VALUES ($1, $2, 1, $3);`,
      [nombre, nombreNorm, ahoraUTC()],
    );

    revalidatePath("/operarios");

    return { ok: true, mensaje: `"${nombre}" se agregó al maestro de operarios.` };
  } catch (error) {
    return { ok: false, mensaje: mensajeDeError(error) };
  }
}

/**
 * Activates or deactivates an operator.
 *
 * Rule O3: a deactivated operator cannot start new stages, but the whole
 * history stays intact and re-activating is enough to use them again. That is
 * why the action only flips the flag instead of deleting the row.
 */
export async function toggleOperario(id: number, activo: boolean): Promise<ResultadoAccion> {
  try {
    await requireSession();

    const operarioId = entero(id, "id");
    const nuevoEstado = !activo;

    const resultado = await query<{ nombre: string }>(
      `UPDATE operarios SET activo = $1 WHERE id = $2 RETURNING nombre;`,
      [nuevoEstado ? 1 : 0, operarioId],
    );

    const nombre = resultado.rows[0]?.nombre;
    if (!nombre) {
      return { ok: false, mensaje: `No existe el operario con id ${operarioId}.` };
    }

    revalidatePath("/operarios");

    return {
      ok: true,
      mensaje: nuevoEstado
        ? `"${nombre}" quedó activo y ya puede fichar etapas.`
        : `"${nombre}" quedó inactivo: su historial se conserva.`,
    };
  } catch (error) {
    return { ok: false, mensaje: mensajeDeError(error) };
  }
}

interface OperarioActual {
  id: number;
  nombre: string;
  nombre_norm: string;
}

/**
 * Renames an operator and regenerates `nombre_norm` on the server.
 *
 * Two things the legacy backend got right and are easy to lose:
 *   · The normalized key collision is checked against OTHER operators only
 *     (`id <> $1`): fixing the accent of your own name is not a conflict.
 *   · Rows in `registros_tiempos` are matched by name, so they are rewritten
 *     in the same transaction (rule O4). Without this, "Pérez" and "Pérez"
 *     fixed would look like two different operators in every metric.
 *
 * The update is skipped when the name did not change at all, so a double
 * submit does not rewrite the history for nothing.
 */
export async function renombrarOperario(id: number, nombre: string): Promise<ResultadoAccion> {
  try {
    await requireSession();

    const operarioId = entero(id, "id");
    const nombreNuevo = textoRequerido(nombre, NOMBRE_CAJA, { max: NOMBRE_MAX });
    const normNuevo = claveNormalizada(nombreNuevo);

    const actuales = await query<OperarioActual>(
      `SELECT id, nombre, nombre_norm FROM operarios WHERE id = $1;`,
      [operarioId],
    );

    const actual = actuales.rows[0];
    if (!actual) {
      return { ok: false, mensaje: `No existe el operario con id ${operarioId}.` };
    }

    if (nombreNuevo === actual.nombre) {
      return { ok: true, mensaje: `El nombre de "${actual.nombre}" no cambió.` };
    }

    if (normNuevo !== actual.nombre_norm) {
      const choque = await query<{ id: number }>(
        `SELECT id FROM operarios WHERE nombre_norm = $1 AND id <> $2;`,
        [normNuevo, operarioId],
      );

      if (choque.rows.length > 0) {
        return {
          ok: false,
          mensaje: `Ya existe otro operario llamado "${nombreNuevo}". Elija otro nombre o edite el operario en conflicto.`,
        };
      }
    }

    const anteriores = actual.nombre;
    let propagados = 0;

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE operarios SET nombre = $1, nombre_norm = $2 WHERE id = $3;`,
        [nombreNuevo, normNuevo, operarioId],
      );

      // Every spelling change propagates, even an accent-only fix, so the
      // master and the history never disagree.
      const registros = await client.query(
        `UPDATE registros_tiempos SET operario_nombre = $1 WHERE lower(operario_nombre) = lower($2);`,
        [nombreNuevo, anteriores],
      );
      propagados = registros.rowCount ?? 0;
    });

    revalidatePath("/operarios");

    return {
      ok: true,
      mensaje:
        propagados > 0
          ? `"${anteriores}" ahora es "${nombreNuevo}". Se corrigieron ${propagados} registro(s) de planta.`
          : `"${anteriores}" ahora es "${nombreNuevo}".`,
    };
  } catch (error) {
    return { ok: false, mensaje: mensajeDeError(error) };
  }
}
