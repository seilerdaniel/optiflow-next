import { cookies } from "next/headers";
import { hashToken } from "@/lib/auth";
import { query } from "@/lib/db";
import { ApiError } from "@/lib/http";
import { SESSION_COOKIE } from "@/lib/session";

/*
 * Session resolution for route handlers.
 *
 * `src/proxy.ts` only checks that the cookie EXISTS (it runs on every request
 * and must stay cheap). Real authorisation happens here: the token is hashed
 * and matched against `sesiones`, and the row must not be closed, expired or
 * belong to a disabled user.
 */

export interface UsuarioSesion {
  id: number;
  usuario: string;
  nombre: string;
  rol: string;
}

export interface SesionActiva {
  sesion_id: number;
  expira_en: string;
  usuario: UsuarioSesion;
}

interface SesionRow {
  sesion_id: number;
  expira_en: string;
  cerrada_en: string | null;
  id: number;
  usuario: string;
  nombre: string;
  rol: string;
  activo: number;
}

/** Returns the active session, or null. Never throws on a missing cookie. */
export async function sesionActual(): Promise<SesionActiva | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const resultado = await query<SesionRow>(
    `SELECT s.id AS sesion_id, s.expira_en, s.cerrada_en,
            u.id, u.usuario, u.nombre, u.rol, u.activo
       FROM sesiones s
       JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = $1;`,
    [hashToken(token)],
  );

  const fila = resultado.rows[0];
  if (!fila) return null;
  if (fila.cerrada_en) return null;
  if (Date.parse(fila.expira_en) <= Date.now()) return null;
  if (!fila.activo) return null;

  return {
    sesion_id: fila.sesion_id,
    expira_en: fila.expira_en,
    usuario: {
      id: fila.id,
      usuario: fila.usuario,
      nombre: fila.nombre,
      rol: fila.rol,
    },
  };
}

/** Same as `sesionActual`, but a missing session becomes a 401. */
export async function requireSession(): Promise<SesionActiva> {
  const sesion = await sesionActual();

  if (!sesion) {
    throw new ApiError(401, "La sesión no está iniciada o expiró.", {
      accion: "Vuelva a ingresar desde /login para continuar.",
    });
  }

  return sesion;
}

/** Roles that can change the plant master data (legacy `gestion`). */
export const ROLES_GESTION = ["admin", "encargado"] as const;

/**
 * Session that may also perform management writes.
 *
 * Sessions carry a role, but until this module nothing enforced it: every route
 * only asked "is somebody logged in", so an `operario` could call any endpoint.
 * The new QMS/TPM writes are too destructive for that (resolving a failure,
 * snapshotting a maintenance counter), so they require gestión. Retrofitting
 * the older routes is a separate, deliberate step.
 */
export async function requireGestion(): Promise<SesionActiva> {
  const sesion = await requireSession();

  if (!(ROLES_GESTION as readonly string[]).includes(sesion.usuario.rol)) {
    throw new ApiError(403, "Esta operación requiere rol de gestión (admin o encargado).", {
      accion: "Pida a un administrador que revise su rol si necesita hacer esta tarea.",
    });
  }

  return sesion;
}
