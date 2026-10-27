/*
 * Despiece domain (Oficina Técnica): types and pure calculations.
 *
 * No `pg`, no HTTP, no Node-only imports. The data layer, the route handlers
 * and (later) the grid UI read the same shapes from here, so a screen and an
 * export can never disagree about what a bulto or an m² means.
 */

/** What a module is called in the plant; it also identifies a bulto. */
export interface ModuloDespiece {
  id: number;
  ot_id: number;
  nombre: string;
  /** D2: assigned by the server, 1..N per OT, one per module. */
  numero_bulto: number;
  piezas: PiezaDespiece[];
  herrajes: HerrajeDespiece[];
}

export interface PiezaDespiece {
  id: number;
  modulo_id: number;
  nombre_pieza: string;
  /** Substrate + thickness as one label: "MDF 18 mm". */
  material: string;
  /** Human-readable size: "700 × 400 mm". */
  dimensiones: string;
  ancho_mm: number;
  profundo_mm: number;
  cantidad: number;
  /** Area of every unit of this row, quantity included (m²). */
  area_m2: number;
  cargado_en_flete: boolean;
  fecha_cargado: string | null;
  requiere_lustre: boolean;
}

export interface HerrajeDespiece {
  id: number;
  modulo_id: number;
  herraje: string;
  cantidad: number;
  entregado_por_panol: boolean;
  fecha_entrega: string | null;
}

/** OT header shown next to the despiece. */
export interface DespieceOT {
  id: number;
  numero_ot: string;
  cliente: string;
  modelo: string | null;
  linea_area: string;
  estado_general: string;
  requiere_lustre: boolean;
}

/** D6: plate consumption grouped by material. */
export interface ResumenPlaca {
  material: string;
  /** How many piece rows share this material. */
  filas: number;
  /** Units (sum of `cantidad`), not rows. */
  piezas: number;
  m2: number;
}

/** D6: hardware sheet grouped by module, for the pañol. */
export interface HojaHerrajesModulo {
  modulo_id: number;
  nombre: string;
  numero_bulto: number;
  herrajes: HerrajeDespiece[];
}

export interface HojaHerrajes {
  modulos: HojaHerrajesModulo[];
  resumen: {
    items: number;
    unidades: number;
    entregados: number;
    pendientes: number;
  };
}

export interface ResumenDespiece {
  modulos: number;
  filas_piezas: number;
  piezas: number;
  /** One bulto per module in this schema. */
  bultos: number;
  m2: number;
  laqueadas: number;
  herrajes: number;
  unidades_herrajes: number;
  piezas_despachadas: number;
  herrajes_entregados: number;
}

export interface DespieceCompleto {
  ot: DespieceOT;
  modulos: ModuloDespiece[];
  resumen_placas: ResumenPlaca[];
  hoja_herrajes: HojaHerrajes;
  resumen: ResumenDespiece;
}

/* -------------------------------------------------------------------------- */
/* Numbers                                                                     */
/* -------------------------------------------------------------------------- */

/** Three decimals: a small piece must not round down to 0.000 m². */
export function r3(valor: number): number {
  return Math.round(valor * 1000) / 1000;
}

/** `700`, `12.5` → the shortest faithful label, without locale separators. */
export function formatearMm(valor: number): string {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return "0";
  return Number.isInteger(numero) ? String(numero) : String(r2(numero));
}

function r2(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/** "700 × 400 mm" — what the operator expects to read on the sheet. */
export function dimensionesDe(anchoMm: number, profundoMm: number): string {
  return `${formatearMm(anchoMm)} × ${formatearMm(profundoMm)} mm`;
}

/** D6: m² of a row, quantity included. */
export function areaPiezaM2(pieza: {
  ancho_mm: number;
  profundo_mm: number;
  cantidad: number;
}): number {
  return r3((Number(pieza.ancho_mm) * Number(pieza.profundo_mm) * Number(pieza.cantidad)) / 1_000_000);
}

/** Totals of a full despiece; the header cards and the API share this. */
export function resumirDespiece(modulos: ModuloDespiece[]): ResumenDespiece {
  let filasPiezas = 0;
  let piezas = 0;
  let m2 = 0;
  let laqueadas = 0;
  let herrajes = 0;
  let unidadesHerrajes = 0;
  let despachadas = 0;
  let entregados = 0;

  for (const modulo of modulos) {
    for (const pieza of modulo.piezas) {
      filasPiezas += 1;
      piezas += pieza.cantidad;
      m2 += areaPiezaM2(pieza);
      if (pieza.requiere_lustre) laqueadas += pieza.cantidad;
      if (pieza.cargado_en_flete) despachadas += pieza.cantidad;
    }

    for (const herraje of modulo.herrajes) {
      herrajes += 1;
      unidadesHerrajes += herraje.cantidad;
      if (herraje.entregado_por_panol) entregados += 1;
    }
  }

  return {
    modulos: modulos.length,
    filas_piezas: filasPiezas,
    piezas,
    // D2 ties one bulto to one module, so the count is exact without a DISTINCT.
    bultos: modulos.length,
    m2: r3(m2),
    laqueadas,
    herrajes,
    unidades_herrajes: unidadesHerrajes,
    piezas_despachadas: despachadas,
    herrajes_entregados: entregados,
  };
}

/** D6 fallback used when the rows are already in memory (API payload). */
export function agruparPlacas(modulos: ModuloDespiece[]): ResumenPlaca[] {
  const mapa = new Map<string, ResumenPlaca>();

  for (const modulo of modulos) {
    for (const pieza of modulo.piezas) {
      let grupo = mapa.get(pieza.material);
      if (!grupo) {
        grupo = { material: pieza.material, filas: 0, piezas: 0, m2: 0 };
        mapa.set(pieza.material, grupo);
      }
      grupo.filas += 1;
      grupo.piezas += pieza.cantidad;
      grupo.m2 += areaPiezaM2(pieza);
    }
  }

  return [...mapa.values()]
    .map((grupo) => ({ ...grupo, m2: r3(grupo.m2) }))
    .sort((a, b) => a.material.localeCompare(b.material, "es"));
}
