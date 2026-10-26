#!/usr/bin/env node
/*
 * Applies every `db/*.sql` file, in filename order, one transaction per file.
 *
 * The legacy backend created its tables at boot (`ensureSchema`). A Next.js
 * server has no boot hook worth relying on: on Vercel each instance would race
 * the others. So the schema is explicit, versioned and run on demand:
 *
 *   npm run db:esquema
 *
 * Files must be idempotent (`create table if not exists`, ...), because this
 * runs against a database that already has data and may already be up to date.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const CARPETA = path.join(process.cwd(), "db");

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error(
      "SUPABASE_DB_URL is not set. Add it to .env.local (npm run db:esquema loads that file).",
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
      await cliente.query(sql);
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
