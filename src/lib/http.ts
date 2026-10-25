import { NextResponse } from "next/server";

/*
 * HTTP helpers shared by the route handlers.
 *
 * The shape is deliberately small and dependency-free: an expected failure is
 * an `ApiError` (status + a message meant for the operator) and anything else
 * becomes a generic 500 that never leaks stack traces or SQL to the client.
 */

/** Expected, client-facing failure. Mirrors the legacy backend's `ApiError`. */
export class ApiError extends Error {
  readonly status: number;

  /** Extra JSON fields merged into the error body (`accion`, `etapa`, ...). */
  readonly detalle: Record<string, unknown> | null;

  constructor(status: number, mensaje: string, detalle?: Record<string, unknown> | null) {
    super(mensaje);
    this.name = "ApiError";
    this.status = status;
    this.detalle = detalle ?? null;
  }
}

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** `{ ok: true, ...datos }` — the success envelope every route returns. */
export function respuestaOk(datos: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json({ ok: true, ...datos }, { status, headers: NO_STORE });
}

/** Maps a thrown value to a JSON error response. Never throws. */
export function respuestaError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { ok: false, error: error.message, ...(error.detalle ?? {}) },
      { status: error.status, headers: NO_STORE },
    );
  }

  console.error("[api] unexpected error:", error);

  return NextResponse.json(
    { ok: false, error: "Ocurrió un error inesperado. Intente nuevamente." },
    { status: 500, headers: NO_STORE },
  );
}

/** Parses the JSON body as a plain object. Empty body means `{}`. */
export async function leerCuerpo(request: Request): Promise<Record<string, unknown>> {
  const crudo = await request.text();
  if (!crudo.trim()) return {};

  let datos: unknown;
  try {
    datos = JSON.parse(crudo);
  } catch {
    throw new ApiError(400, "JSON inválido en el cuerpo de la solicitud.");
  }

  if (!datos || typeof datos !== "object" || Array.isArray(datos)) {
    throw new ApiError(400, "El cuerpo de la solicitud debe ser un objeto JSON.");
  }

  return datos as Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Validators                                                                  */
/* -------------------------------------------------------------------------- */

export function textoRequerido(
  valor: unknown,
  campo: string,
  { max = 120, min = 1 }: { max?: number; min?: number } = {},
): string {
  const texto = (valor === undefined || valor === null ? "" : String(valor)).trim();
  if (texto.length < min) throw new ApiError(400, `El campo "${campo}" es obligatorio.`);
  if (texto.length > max) throw new ApiError(400, `El campo "${campo}" supera los ${max} caracteres.`);
  return texto;
}

export function textoOpcional(
  valor: unknown,
  campo: string,
  { max = 500 }: { max?: number } = {},
): string | null {
  if (valor === undefined || valor === null) return null;
  const texto = String(valor).trim();
  if (!texto) return null;
  if (texto.length > max) throw new ApiError(400, `El campo "${campo}" supera los ${max} caracteres.`);
  return texto;
}

/** Positive integer identifier (`12` or `"12"`). */
export function entero(valor: unknown, campo: string): number;
export function entero(
  valor: unknown,
  campo: string,
  opciones: { requerido: false },
): number | null;
export function entero(
  valor: unknown,
  campo: string,
  { requerido = true }: { requerido?: boolean } = {},
): number | null {
  if (valor === undefined || valor === null || valor === "") {
    if (requerido) throw new ApiError(400, `El campo "${campo}" es obligatorio.`);
    return null;
  }

  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new ApiError(400, `El campo "${campo}" debe ser un identificador válido.`);
  }

  return numero;
}

/** Accepts both `12.5` and `12,5` (the plant types decimals with a comma). */
export function decimal(
  valor: unknown,
  campo: string,
  { min = 0, max = 1_000_000, requerido = false, porDefecto = 0 } = {},
): number {
  if (valor === undefined || valor === null || valor === "") {
    if (requerido) throw new ApiError(400, `El campo "${campo}" es obligatorio.`);
    return porDefecto;
  }

  const numero = Number(String(valor).replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(numero)) {
    throw new ApiError(400, `El campo "${campo}" debe ser numérico.`);
  }
  if (numero < min || numero > max) {
    throw new ApiError(400, `El campo "${campo}" está fuera del rango permitido.`);
  }

  return numero;
}

/** `YYYY-MM-DD`, or `null` for an empty value. */
export function fecha(valor: unknown, campo: string): string | null {
  if (valor === undefined || valor === null || valor === "") return null;

  const texto = String(valor).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto) || Number.isNaN(new Date(`${texto}T00:00:00`).getTime())) {
    throw new ApiError(400, `El campo "${campo}" debe tener formato YYYY-MM-DD.`);
  }

  return texto;
}

/** Lenient boolean: `true`, `1`, `"1"`, `"si"`, `"sí"` all mean true. */
export function booleano(valor: unknown, porDefecto = false): boolean {
  if (valor === undefined || valor === null || valor === "") return porDefecto;
  if (typeof valor === "boolean") return valor;
  if (typeof valor === "number") return valor !== 0;

  const texto = String(valor).trim().toLowerCase();
  return texto === "true" || texto === "1" || texto === "si" || texto === "sí";
}

export function enumOpcion<T extends string>(
  valor: unknown,
  opciones: readonly T[],
  campo: string,
): T {
  const texto = (valor === undefined || valor === null ? "" : String(valor)).trim();
  if (!texto) throw new ApiError(400, `El campo "${campo}" es obligatorio.`);

  const encontrado = opciones.find((opcion) => opcion === texto);
  if (!encontrado) {
    throw new ApiError(
      400,
      `Valor no permitido para "${campo}". Opciones válidas: ${opciones.join(", ")}.`,
    );
  }

  return encontrado;
}
