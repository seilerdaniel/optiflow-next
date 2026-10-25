import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

/*
 * Password hashing and session tokens, ported from the legacy backend
 * (`server/lib/auth.js`). The parameters are identical so hashes already
 * stored in `usuarios.password_hash/password_salt` keep validating:
 *
 *   scrypt N=16384, r=8, p=1 · 16-byte random salt · 64-byte derived key · hex
 *
 * The only difference is that `scrypt` is asynchronous here: a synchronous
 * derivation blocks the whole Next.js server for ~50-100 ms per login.
 */

const SCRYPT_N = 16_384;
const SCRYPT_KEY_LENGTH = 64;
const SALT_BYTES = 16;

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/** Derives `{ hash, salt }` (hex) for a plain-text password. */
export async function hashPassword(
  password: string,
  saltHex?: string,
): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : randomBytes(SALT_BYTES);
  const derivedKey = await scryptAsync(String(password), salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
  });

  return { hash: derivedKey.toString("hex"), salt: salt.toString("hex") };
}

/** Constant-time verification. Never throws on malformed stored values. */
export async function verifyPassword(
  password: string,
  hashHex: string | null,
  saltHex: string | null,
): Promise<boolean> {
  if (!hashHex || !saltHex) return false;

  const expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;

  const salt = Buffer.from(saltHex, "hex");
  const derivedKey = await scryptAsync(String(password), salt, expected.length, {
    N: SCRYPT_N,
  });

  return expected.length === derivedKey.length && timingSafeEqual(expected, derivedKey);
}

/** Opaque 32-byte session token (hex). Only the client ever sees it. */
export function createSessionToken(): string {
  return randomBytes(32).toString("hex");
}

/** SHA-256 of the token: the only form persisted in `sesiones.token_hash`. */
export function hashToken(token: string): string {
  return createHash("sha256").update(String(token)).digest("hex");
}

/**
 * Deterministic signed int32 key for `pg_advisory_*` locks.
 *
 * Advisory lock keys are `(class, id)` pairs of int4, so a free-text value
 * (an operator name, for instance) needs a stable reduction. Same algorithm
 * as the legacy backend, so locks taken by both stacks still collide.
 */
export function lockKey(text: string): number {
  const hex = createHash("sha256").update(String(text)).digest("hex").slice(0, 8);
  return parseInt(hex, 16) | 0;
}

/* -------------------------------------------------------------------------- */
/* Login rate limiting                                                        */
/* -------------------------------------------------------------------------- */

const MAX_ATTEMPTS = Math.max(1, Number(process.env.OPTIFLOW_LOGIN_MAX) || 8);

/** Blocking window: 15 minutes, as in the legacy backend. */
export const ATTEMPT_WINDOW_SECONDS = 15 * 60;

const attemptWindowMs = ATTEMPT_WINDOW_SECONDS * 1000;

/**
 * In-memory attempt counter, keyed by `ip|usuario`.
 *
 * Caveat: memory is per instance. It stops a single-source brute-force loop
 * against one server, but it is not a distributed limiter. A multi-instance
 * deployment needs a shared store (Postgres or Redis) to enforce this globally.
 */
const attempts = new Map<string, { count: number; since: number }>();

function purgeExpired(now: number) {
  for (const [key, record] of attempts) {
    if (now - record.since > attemptWindowMs) attempts.delete(key);
  }
}

/** Registers an attempt and reports whether it is still allowed. */
export function allowLoginAttempt(key: string): boolean {
  const now = Date.now();
  const record = attempts.get(key);

  if (!record || now - record.since > attemptWindowMs) {
    if (attempts.size > 1000) purgeExpired(now);
    attempts.set(key, { count: 1, since: now });
    return true;
  }

  record.count += 1;
  return record.count <= MAX_ATTEMPTS;
}

/** Clears the counter after a successful login. */
export function registerSuccessfulLogin(key: string): void {
  attempts.delete(key);
}

/* -------------------------------------------------------------------------- */
/* Request metadata                                                           */
/* -------------------------------------------------------------------------- */

function normaliseIp(value: string | null): string | null {
  if (!value) return null;

  let candidate = value.trim();

  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(candidate); // [IPv6]:port
  if (bracketed) {
    candidate = bracketed[1];
  } else if (!candidate.includes("::") && candidate.includes(":") && candidate.includes(".")) {
    candidate = candidate.replace(/:\d+$/, ""); // IPv4:port
  }

  candidate = candidate.replace(/^::ffff:/i, "").trim();
  return candidate || null;
}

/**
 * Client IP behind a proxy.
 *
 * `x-real-ip` is set by the trusted proxy and cannot be spoofed. For
 * `x-forwarded-for` the LAST hop is used: the client controls the left side and
 * could otherwise rotate the value to bypass the rate limit.
 */
export function clientIp(request: Request): string | null {
  const realIp = normaliseIp(request.headers.get("x-real-ip"));
  if (realIp) return realIp;

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((hop) => normaliseIp(hop))
      .filter((hop): hop is string => hop !== null);

    if (hops.length > 0) return hops[hops.length - 1];
  }

  return null;
}

/** Rate-limit key: real client IP plus the attempted username. */
export function loginAttemptKey(request: Request, username: string): string {
  return `${clientIp(request) ?? "unknown"}|${username.toLowerCase()}`;
}
