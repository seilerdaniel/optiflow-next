#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- this is a plain CJS script, not part of the app bundle */
/*
 * Seeds the data the application needs to boot:
 *
 *   npm run db:seed
 *
 * Two things are seeded, both idempotent:
 *
 *   1. The 16 base sectors, on conflict by `nombre_sector` do nothing. Rows the
 *      plant already edited are never overwritten, so re-running this is safe.
 *   2. An active `admin` user, so a fresh database can be logged into. The
 *      password comes from the environment or is generated once and printed.
 *
 * Secrets are never written to disk by this script: either you provide them in
 * `.env.local` / the shell, or the generated password is shown one time and
 * you are expected to store it.
 *
 * The scrypt parameters MUST match `src/lib/auth.ts` (they are the legacy
 * backend's parameters, so hashes stay compatible):
 *
 *   N=16384, r=8, p=1 · 16-byte salt · 64-byte derived key · hex
 *
 * This script is plain CommonJS and cannot import TypeScript, hence the copy.
 */

const { randomBytes, randomInt, scrypt } = require("node:crypto");
const { Client } = require("pg");
const { urlBaseDatos } = require("./env");

const SCRYPT_N = 16_384;
const SCRYPT_KEY_LENGTH = 64;
const SALT_BYTES = 16;

/** Same shape as the `SECTORES_BASE` list of the legacy backend. */
const SECTORES = [
  // Placares
  ["Seccionadora / Corte", "Corte", 0, null, "Placares", 1, null],
  ["Enfiladora", "Enfiladora", 0, null, "Placares", 2, null],
  ["Pantógrafo CNC / Mecanizado", "Pantógrafo", 0, null, "Placares", 3, null],
  ["Armado de Cajoneras", "Cajoneras", 1, null, "Placares", 4, null],
  ["Colocación de Herrajes", "Herrajes", 1, null, "Placares", 5, null],
  ["Control de Calidad", "Control de Calidad", 1, null, "Placares", 6, null],
  ["Embalaje Final", "Embalaje", 1, null, "Placares", 7, null],
  // Cocinas
  ["Seccionadora B / Corte Módulos", "Corte B", 0, null, "Cocinas", 1, null],
  ["Enfilado de Cantos Cocina", "Enfilado Cocina", 0, null, "Cocinas", 2, null],
  ["Mecanizado de Puertas de Cocina", "Mec. Puertas", 0, null, "Cocinas", 3, "José"],
  ["Armado de Módulos de Cocina", "Módulos Cocina", 0, null, "Cocinas", 4, null],
  ["Secuenciado y Distribución de Piezas", "Secuenciado", 0, null, "Cocinas", 5, "Joel, Tiago"],
  // Shared / special
  ["Puertas de Vidrio", "Vidrio", 0, "vidrio", "Compartido", 1, "Tomás"],
  ["Lustre", "Lustre", 1, "lustre", "Compartido", 2, "Alejandro"],
  ["Herrería", "Herrería", 1, "herreria", "Compartido", 3, "Julio, Jony"],
  ["Especiales", "Especiales", 1, "especiales", "Compartido", 4, "Pablo"],
];

const ALFABETO_PASSWORD = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function scryptAsync(password, salt, keyLength, options) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/** Same contract as `hashPassword()` in `src/lib/auth.ts`. */
async function hashPassword(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : randomBytes(SALT_BYTES);
  const derivedKey = await scryptAsync(String(password), salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
  });

  return { hash: derivedKey.toString("hex"), salt: salt.toString("hex") };
}

/** Printable password without characters that are easy to confuse (0/O, 1/l). */
function generarPassword(largo = 20) {
  let salida = "";
  for (let i = 0; i < largo; i += 1) {
    salida += ALFABETO_PASSWORD[randomInt(ALFABETO_PASSWORD.length)];
  }
  return salida;
}

/** Same normalization the app uses for `nombre_norm`. */
function normalizar(texto) {
  return texto.trim().replace(/\s+/g, " ").toLowerCase();
}

function ahoraUTC() {
  return new Date().toISOString();
}

async function sembrarSectores(client) {
  let nuevos = 0;
  let existentes = 0;

  for (const [nombreSector, nombreCorto, esCompartido, clave, linea, orden, sugeridos] of SECTORES) {
    const result = await client.query(
      `insert into public.sectores
         (nombre_sector, nombre_corto, es_compartido, clave_especial,
          linea_area, orden_flujo, operarios_sugeridos, activo)
       values ($1, $2, $3, $4, $5, $6, $7, 1)
       on conflict (nombre_sector) do nothing`,
      [nombreSector, nombreCorto, esCompartido, clave, linea, orden, sugeridos],
    );

    if (result.rowCount === 1) nuevos += 1;
    else existentes += 1;
  }

  return { nuevos, existentes };
}

async function asegurarAdmin(client) {
  const usuario = (process.env.OPTIFLOW_ADMIN_USER ?? "admin").trim().toLowerCase();
  const nombre = (process.env.OPTIFLOW_ADMIN_NAME ?? "Administrador").trim();
  // An empty variable (the `.env.example` default) means "generate one", not
  // "use an empty password": only a non-empty value is treated as provided.
  const passwordCruda = process.env.OPTIFLOW_ADMIN_PASSWORD;
  const passwordEnv = passwordCruda && passwordCruda.length > 0 ? passwordCruda : undefined;

  if (!usuario) {
    throw new Error("OPTIFLOW_ADMIN_USER está vacío.");
  }

  const nombreNorm = normalizar(nombre);
  const existente = await client.query(
    "select id, rol, activo from public.usuarios where usuario = $1;",
    [usuario],
  );

  const ahora = ahoraUTC();

  if (existente.rowCount > 0) {
    const fila = existente.rows[0];

    // An existing admin is only repaired (role/flag) unless a password was
    // explicitly provided: never silently rotate a working credential.
    if (passwordEnv) {
      const { hash, salt } = await hashPassword(passwordEnv);
      await client.query(
        `update public.usuarios
            set rol = 'admin', activo = 1,
                password_hash = $2, password_salt = $3,
                fecha_actualizacion = $4
          where id = $1;`,
        [fila.id, hash, salt, ahora],
      );
      return { estado: "actualizado", usuario, password: passwordEnv, generada: false };
    }

    if (fila.rol !== "admin" || fila.activo !== 1) {
      await client.query(
        "update public.usuarios set rol = 'admin', activo = 1, fecha_actualizacion = $2 where id = $1;",
        [fila.id, ahora],
      );
    }

    return { estado: "existente", usuario, password: null, generada: false };
  }

  const colision = await client.query(
    "select usuario from public.usuarios where nombre_norm = $1;",
    [nombreNorm],
  );
  if (colision.rowCount > 0) {
    throw new Error(
      `Ya existe el usuario "${colision.rows[0].usuario}" con nombre_norm "${nombreNorm}". ` +
        "Defina OPTIFLOW_ADMIN_NAME con otro nombre.",
    );
  }

  const password = passwordEnv ?? generarPassword();
  const { hash, salt } = await hashPassword(password);

  await client.query(
    `insert into public.usuarios
       (usuario, nombre, nombre_norm, email, password_hash, password_salt,
        rol, activo, fecha_creacion, fecha_actualizacion)
     values ($1, $2, $3, null, $4, $5, 'admin', 1, $6, $6);`,
    [usuario, nombre, nombreNorm, hash, salt, ahora],
  );

  return { estado: "creado", usuario, password, generada: !passwordEnv };
}

async function main() {
  const url = await urlBaseDatos();
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    await client.query("begin");
    const sectores = await sembrarSectores(client);
    const admin = await asegurarAdmin(client);
    await client.query("commit");

    console.log(
      `ok  sectores: ${sectores.nuevos} nuevo(s), ${sectores.existentes} ya existían.`,
    );
    console.log(`ok  admin: usuario "${admin.usuario}" ${admin.estado}.`);

    if (admin.generada) {
      console.log("");
      console.log("  Contraseña generada (se muestra una sola vez):");
      console.log(`    ${admin.password}`);
      console.log("");
      console.log("  Guárdela ahora. Para fijar otra, defina:");
      console.log("    OPTIFLOW_ADMIN_PASSWORD=...");
      console.log("    OPTIFLOW_ADMIN_USER=...    (por defecto: admin)");
      console.log("    OPTIFLOW_ADMIN_NAME=...    (por defecto: Administrador)");
    } else if (admin.password) {
      console.log("  Contraseña tomada de OPTIFLOW_ADMIN_PASSWORD.");
    } else {
      console.log("  La contraseña existente no se modificó.");
    }
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`\nFalló el seed: ${error.message}`);
  process.exit(1);
});
