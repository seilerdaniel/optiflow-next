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
 * `.env.local` is read here instead of relying on `--env-file`, so the same
 * command works from any shell and on any Node >= 20.
 *
 * Every file must be idempotent (`create table if not exists`, ...): this runs
 * against a database that already has data and is usually already up to date.
 */

const { readdir, readFile } = require("node:fs/promises");
const path = require("node:path");
const { Client } = require("pg");

const CARPETA = path.join(process.cwd(), "db");
const ENV_LOCAL = path.join(process.cwd(), ".env.local");

/** Minimal `.env` reader: `KEY=value`, optional quotes, `#` comments. */
async function cargarEnvLocal() {
  if (process.env.SUPABASE_DB_URL) return;

  let texto;
  try {
    texto = await readFile(ENV_LOCAL, "utf8");
  } catch {
    return;
  }

  for (const linea of texto.split(/\r?\n/)) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#")) continue;

    const corte = limpia.indexOf("=");
    if (corte <= 0) continue;

    const clave = limpia.slice(0, corte).trim();
    if (process.env[clave] !== undefined) continue;

    process.env[clave] = limpia
      .slice(corte + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .replace(/^'(.*)'$/, "$1");
  }
}

async function main() {
  await cargarEnvLocal();

  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error(
      "SUPABASE_DB_URL is not set. Add it to .env.local or export it in the shell.",
    );
    process.exit(1);
  }

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
