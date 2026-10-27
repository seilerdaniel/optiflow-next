/**
 * Result of a Server Action, shaped for inline feedback.
 *
 * Kept free of server-only imports so client islands can use the type without
 * pulling the data layer into the browser bundle.
 */
export interface ResultadoAccion {
  ok: boolean;
  mensaje: string | null;
}

/** Neutral starting state: no message until the user submits. */
export const RESULTADO_INICIAL: ResultadoAccion = { ok: false, mensaje: null };
