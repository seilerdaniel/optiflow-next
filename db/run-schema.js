#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- this is a plain CJS script, not part of the app bundle */
/*
 * Applies every `db/*.sql` file, in filename order, one transaction per file.
 *
 *   npm run db:esquema
 *
 * Why a script instead of a boot hook: the legacy backend created its tables in
 * `ensureSchema()` at startup, but a Next.js server has no single boot point
 * (dev reloads, multiple serverless instances). Creating tables at runtime
 * would race itself. So the schema is a versioned artifact applied on demand.
 *
 * `.env.local` is read by `db/env.js` instead of relying on `--env-file`, so
 * the same command works from any shell and on any Node >= 20.
 *
 * Every file must be idempotent (`create table if not exists`, ...): this runs
 * against a database that already has data and is usually already up to date.
 */

const { readdir, readFile } = require("node:fs/promises");
const path = require("node:path");
const { Client } = require("pg");
const { urlBaseDatos } = require("./env");

const CARPETA = path.join(process.cwd(), "db");

/*
 * Transaction control belongs to the runner, not to the files.
 *
 * Each file is applied inside one BEGIN/COMMIT pair, so a file that opens or
 * closes a transaction of its own breaks that guarantee: a nested BEGIN only
 * emits a warning, and its COMMIT closes the runner's transaction early, so
 * everything after it runs in autocommit. That is exactly the bug `001` had.
 *
 * The check ignores comments and quoted literals, and dollar-quoted bodies
 * (`$$ ... $$`) so a PL/pgSQL function can still use its own BEGIN/END.
 */
const CONTROL_TRANSACCION =
  /\b(?:begin(?:\s+(?:transaction|work))?|start\s+transaction|commit(?:\s+(?:transaction|work))?|rollback(?:\s+(?:transaction|work))?)\s*;/i;

function transaccionExplicita(sql) {
  const visible = sql
    .replace(/\$[A-Za-z_]*\$[\s\S]*?\$[A-Za-z_]*\$/g, " ") // cuerpos $$ ... $$
    .replace(/\/\*[\s\S]*?\*\//g, " ") // comentarios de bloque
    .replace(/--[^\n]*/g, " ") // comentarios de línea
    .replace(/'(?:''|[^'])*'/g, " "); // literales de texto

  const encontrada = CONTROL_TRANSACCION.exec(visible);
  return encontrada ? encontrada[0].trim() : null;
}

async function main() {
  const url = await urlBaseDatos();

  const archivos = (await readdir(CARPETA)).filter((nombre) => nombre.endsWith(".sql")).sort();

  if (archivos.length === 0) {
    console.log(`No .sql files in ${CARPETA}.`);
    return;
  }

  const cliente = new Client({ connectionString: url });
  await cliente.connect();

  try {
    for (const archivo of archivos) {
      const sql = await readFile(path.join(CARPETA, archivo), "utf8");

      const control = transaccionExplicita(sql);
      if (control) {
        throw new Error(
          `${archivo}: contiene "${control}" explícito. ` +
            "Quitalo: el runner ya envuelve cada archivo en su propia transacción.",
        );
      }

      // One transaction per file: a failing `002_despiece.sql` must not leave
      // half of the tables created, and the next run starts from a clean state.
      await cliente.query("BEGIN");
      try {
        await cliente.query(sql);
        await cliente.query("COMMIT");
      } catch (error) {
        await cliente.query("ROLLBACK").catch(() => undefined);
        throw new Error(`${archivo}: ${error.message}`);
      }

      console.log(`ok  ${archivo}`);
    }
  } finally {
    await cliente.end();
  }

  console.log(`\n${archivos.length} archivo(s) aplicados.`);
}

main().catch((error) => {
  console.error(`\nFalló el esquema: ${error.message}`);
  process.exit(1);
});
