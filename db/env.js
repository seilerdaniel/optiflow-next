/* eslint-disable @typescript-eslint/no-require-imports -- plain CJS helper for the db scripts */
/*
 * Shared plumbing for the scripts in `db/`.
 *
 * They are plain Node scripts (not part of the Next.js bundle), so they cannot
 * import `src/lib/*`: this file keeps the `.env.local` parsing in one place so
 * every script in `db/` reads the database URL exactly the same way.
 */

const { readFile } = require("node:fs/promises");
const path = require("node:path");

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

/** Loads `.env.local` and returns `SUPABASE_DB_URL`, or exits with a hint. */
async function urlBaseDatos() {
  await cargarEnvLocal();

  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error(
      "SUPABASE_DB_URL is not set. Add it to .env.local or export it in the shell.",
    );
    process.exit(1);
  }

  return url;
}

module.exports = { cargarEnvLocal, urlBaseDatos };
