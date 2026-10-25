/*
 * Session policy shared by the login route, the proxy and (later) logout.
 * This module must stay dependency-free: the proxy imports it to read the
 * cookie name, and it must not drag `node:crypto` or `pg` into that bundle.
 */

export const SESSION_COOKIE = "optiflow_sesion";

/** Session lifetime in seconds (legacy `OPTIFLOW_SESION_HORAS`, default 12 h). */
export const SESSION_SECONDS =
  Math.max(1, Number(process.env.OPTIFLOW_SESION_HORAS) || 12) * 3600;

/** Cookie options for `cookies().set(...)`. */
export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_SECONDS,
  } as const;
}
