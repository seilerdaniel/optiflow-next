import {
  Pool,
  types,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "pg";

/*
 * PostgreSQL access layer (Supabase pooler) — no ORM, just `pg`.
 *
 * The pool is created lazily on the first query and cached on `globalThis` so
 * Next.js hot reloads and serverless warm starts reuse the same connections.
 * Nothing is read from the environment at import time: `next build` must be
 * able to compile the route handlers without a database URL present.
 */

// `int8` (COUNT/SUM) and `numeric` are returned as strings by default to avoid
// precision loss. The application expects numbers, as the legacy data layer did.
types.setTypeParser(20, (value) => Number(value));
types.setTypeParser(1700, (value) => Number(value));

const POOL_MAX = Number(process.env.PG_POOL_MAX) || 10;
const IDLE_TIMEOUT_MS = Number(process.env.PG_IDLE_MS) || 30_000;
const CONNECT_TIMEOUT_MS = Number(process.env.PG_CONNECT_MS) || 10_000;

/** Advisory-lock classes used by `withTransaction`. Mirrors the legacy backend. */
export const LOCK_SECTOR = 1;
export const LOCK_OT = 2;
export const LOCK_OPERATOR = 3;
export const LOCK_USER = 4;

/** @deprecated Use `LOCK_OT`: the domain calls it a work order. */
export const LOCK_WORK_ORDER = LOCK_OT;

declare global {
  var optiflowPool: Pool | undefined;
}

function connectionString(): string {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      "SUPABASE_DB_URL is not set. Add the Supabase connection string " +
        "(Project Settings > Database > Connection string) to .env.local.",
    );
  }
  return url;
}

/** Lazily-created singleton pool. */
export function getPool(): Pool {
  if (!globalThis.optiflowPool) {
    const pool = new Pool({
      connectionString: connectionString(),
      max: POOL_MAX,
      idleTimeoutMillis: IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    });

    pool.on("error", (error) => {
      console.error("[db] idle client error:", error.message);
    });

    globalThis.optiflowPool = pool;
  }

  return globalThis.optiflowPool;
}

/** Typed `pool.query` shortcut. */
export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params);
}

/**
 * Runs `fn` inside a real transaction on a dedicated client.
 *
 * `locks` are `pg_advisory_xact_lock` keys `[class, id]`, taken before `fn` and
 * released automatically on COMMIT/ROLLBACK. They serialise competing writes
 * (e.g. two simultaneous logins for the same user) across instances without
 * table-level locks. Keys are deduplicated and sorted to avoid deadlocks.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  locks: ReadonlyArray<readonly [number, number]> = [],
): Promise<T> {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    const ordered = [...new Map(locks.map(([lockClass, id]) => [`${lockClass}:${id}`, [lockClass, id] as const])).values()].sort(
      (a, b) => a[0] - b[0] || a[1] - b[1],
    );

    for (const [lockClass, id] of ordered) {
      await client.query("SELECT pg_advisory_xact_lock($1, $2);", [lockClass, id]);
    }

    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
