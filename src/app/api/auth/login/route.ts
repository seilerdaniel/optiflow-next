import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import type { QueryResultRow } from "pg";
import {
  ATTEMPT_WINDOW_SECONDS,
  allowLoginAttempt,
  clientIp,
  createSessionToken,
  hashToken,
  loginAttemptKey,
  registerSuccessfulLogin,
  verifyPassword,
} from "@/lib/auth";
import { LOCK_USER, query, withTransaction } from "@/lib/db";
import { SESSION_COOKIE, SESSION_SECONDS, sessionCookieOptions } from "@/lib/session";

interface UsuarioRow extends QueryResultRow {
  id: number;
  usuario: string;
  nombre: string;
  rol: string;
  activo: number;
  password_hash: string;
  password_salt: string;
}

const INVALID_CREDENTIALS = "Usuario o contraseña incorrectos.";

// Throwaway material for unknown users: same cost, always false.
const DUMMY_HASH = "0".repeat(128);
const DUMMY_SALT = "0".repeat(32);

function fail(status: number, error: string, headers?: HeadersInit) {
  return NextResponse.json({ ok: false, error }, { status, headers });
}

function isSecureRequest(request: NextRequest): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return forwardedProto === "https" || request.nextUrl.protocol === "https:";
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    usuario?: unknown;
    password?: unknown;
  } | null;

  const usuario = String(body?.usuario ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  if (!usuario || !password) {
    return fail(400, "Debe indicar usuario y contraseña.");
  }

  // Rate limit runs before touching the database: a brute-force loop must not
  // be able to turn into extra connection load.
  const attemptKey = loginAttemptKey(request, usuario);
  if (!allowLoginAttempt(attemptKey)) {
    return fail(429, "Demasiados intentos de acceso. Espere unos minutos y vuelva a intentar.", {
      "Retry-After": String(ATTEMPT_WINDOW_SECONDS),
    });
  }

  let usuarioRow: UsuarioRow | undefined;

  try {
    const result = await query<UsuarioRow>(
      `SELECT id, usuario, nombre, rol, activo, password_hash, password_salt
         FROM usuarios
        WHERE usuario = $1;`,
      [usuario],
    );
    usuarioRow = result.rows[0];
  } catch (error) {
    console.error("[auth/login] database error:", error);
    return fail(503, "No se pudo validar el acceso. Intente nuevamente en unos instantes.");
  }

  const passwordMatches = await verifyPassword(
    password,
    usuarioRow?.password_hash ?? DUMMY_HASH,
    usuarioRow?.password_salt ?? DUMMY_SALT,
  );

  // One generic answer for unknown user, disabled account and wrong password:
  // the response must not reveal which accounts exist. The derivation above
  // runs even for unknown users so the response time does not leak it either.
  if (!usuarioRow || !usuarioRow.activo || !passwordMatches) {
    return fail(401, INVALID_CREDENTIALS);
  }

  registerSuccessfulLogin(attemptKey);

  const token = createSessionToken();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  const ip = clientIp(request);
  const userAgent = request.headers.get("user-agent")?.slice(0, 300) ?? null;

  try {
    await withTransaction(
      async (client) => {
        // Session displacement: logging in anywhere invalidates whatever
        // session this user had open on another device.
        await client.query("DELETE FROM sesiones WHERE usuario_id = $1;", [usuarioRow.id]);

        await client.query(
          `INSERT INTO sesiones (usuario_id, token_hash, ip, user_agent, creada_en, expira_en, fecha_creacion)
           VALUES ($1, $2, $3, $4, $5, $6, $5);`,
          [usuarioRow.id, hashToken(token), ip, userAgent, createdAt, expiresAt],
        );

        await client.query("UPDATE usuarios SET ultimo_acceso = $1 WHERE id = $2;", [
          createdAt,
          usuarioRow.id,
        ]);
      },
      // Serialises two logins for the same user across instances, so the
      // delete + insert pair cannot leave two live sessions behind.
      [[LOCK_USER, Number(usuarioRow.id)]],
    );
  } catch (error) {
    console.error("[auth/login] session error:", error);
    return fail(503, "No se pudo iniciar la sesión. Intente nuevamente en unos instantes.");
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions(isSecureRequest(request)));

  return NextResponse.json({
    ok: true,
    usuario: {
      id: usuarioRow.id,
      usuario: usuarioRow.usuario,
      nombre: usuarioRow.nombre,
      rol: usuarioRow.rol,
    },
    expira_en: expiresAt,
  });
}
