/*
 * Módulo 5 — Oficina Técnica: despiece CAD/CAM, bultos y pañol.
 *
 * Idempotente: se puede aplicar tantas veces como haga falta sobre una base con
 * datos (`npm run db:esquema` recorre los `.sql` de `db/` en orden).
 *
 * MODELO
 *   ordenes_trabajo
 *     └─ ot_despiece_modulos        (ON DELETE CASCADE)
 *          ├─ ot_despiece_piezas   (ON DELETE CASCADE)
 *          └─ ot_herrajes_lista    (ON DELETE CASCADE)
 *
 * El borrado de una OT arrastra módulos, piezas y herrajes por la cadena de
 * cascadas: no queda ninguna fila huérfana que después bloquee la limpieza.
 *
 * `dimensiones` es el texto que lee el operario ("700 × 400 mm"); `ancho_mm`,
 * `profundo_mm` y `cantidad` son la fuente de verdad numérica para calcular m²
 * (D6). Guardar sólo el texto obligaría a parsear strings para cada reporte.
 *
 * Los timestamps son `text` ISO-8601 UTC, igual que el resto del esquema: la
 * aplicación los genera con `ahoraUTC()` y nunca depende del reloj del cliente.
 */

CREATE TABLE IF NOT EXISTS ot_despiece_modulos (
  id                  BIGSERIAL PRIMARY KEY,
  ot_id               BIGINT NOT NULL
                        REFERENCES ordenes_trabajo (id) ON DELETE CASCADE,
  nombre              TEXT NOT NULL CHECK (btrim(nombre) <> ''),
  numero_bulto        INTEGER NOT NULL CHECK (numero_bulto > 0),
  fecha_creacion      TEXT NOT NULL,
  fecha_actualizacion TEXT NOT NULL,
  CONSTRAINT uq_despiece_modulo_bulto UNIQUE (ot_id, numero_bulto)
);

CREATE INDEX IF NOT EXISTS idx_despiece_modulos_ot
  ON ot_despiece_modulos (ot_id);

CREATE TABLE IF NOT EXISTS ot_despiece_piezas (
  id                  BIGSERIAL PRIMARY KEY,
  modulo_id           BIGINT NOT NULL
                        REFERENCES ot_despiece_modulos (id) ON DELETE CASCADE,
  nombre_pieza        TEXT NOT NULL CHECK (btrim(nombre_pieza) <> ''),
  /* Sustrato + espesor en un solo campo: "MDF 18 mm", "Melamina 18 mm". */
  material            TEXT NOT NULL CHECK (btrim(material) <> ''),
  dimensiones         TEXT NOT NULL,
  ancho_mm            NUMERIC(10, 2) NOT NULL CHECK (ancho_mm > 0),
  profundo_mm         NUMERIC(10, 2) NOT NULL CHECK (profundo_mm > 0),
  cantidad            INTEGER NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  cargado_en_flete    BOOLEAN NOT NULL DEFAULT FALSE,
  requiere_lustre     BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_cargado       TEXT,
  fecha_creacion      TEXT NOT NULL,
  fecha_actualizacion TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_despiece_piezas_modulo
  ON ot_despiece_piezas (modulo_id);

CREATE TABLE IF NOT EXISTS ot_herrajes_lista (
  id                  BIGSERIAL PRIMARY KEY,
  modulo_id           BIGINT NOT NULL
                        REFERENCES ot_despiece_modulos (id) ON DELETE CASCADE,
  herraje             TEXT NOT NULL CHECK (btrim(herraje) <> ''),
  cantidad            INTEGER NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  entregado_por_panol BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_entrega       TEXT,
  fecha_creacion      TEXT NOT NULL,
  fecha_actualizacion TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_herrajes_modulo
  ON ot_herrajes_lista (modulo_id);
