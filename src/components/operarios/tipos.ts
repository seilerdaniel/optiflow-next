/** Result of a Server Action, shaped for `useActionState` / inline feedback. */
export interface ResultadoAccion {
  ok: boolean;
  mensaje: string | null;
}

/** Neutral starting state: no message until the user submits. */
export const RESULTADO_INICIAL: ResultadoAccion = { ok: false, mensaje: null };
