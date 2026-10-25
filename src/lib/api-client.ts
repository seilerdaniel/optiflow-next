/*
 * Tiny client-side fetch helper for the office screens.
 *
 * The API answers with `{ ok: true, ...datos }` or `{ ok: false, error, accion }`,
 * so the wrapper turns any non-2xx into an `ErrorApi` the UI can render without
 * re-parsing bodies by hand.
 */

export class ErrorApi extends Error {
  readonly status: number;
  readonly accion: string | null;
  readonly cuerpo: Record<string, unknown>;

  constructor(
    status: number,
    mensaje: string,
    accion: string | null,
    cuerpo: Record<string, unknown> = {},
  ) {
    super(mensaje);
    this.name = "ErrorApi";
    this.status = status;
    this.accion = accion;
    this.cuerpo = cuerpo;
  }
}

export async function pedirJson<T>(
  url: string,
  init: { method?: string; body?: string } = {},
): Promise<T> {
  const respuesta = await fetch(url, {
    method: init.method ?? "GET",
    body: init.body,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });

  const crudo: unknown = await respuesta.json().catch(() => null);
  const cuerpo = (crudo ?? {}) as Record<string, unknown>;

  if (!respuesta.ok || cuerpo.ok !== true) {
    const mensaje =
      typeof cuerpo.error === "string"
        ? cuerpo.error
        : `El servidor respondió ${respuesta.status}. Intente nuevamente.`;

    throw new ErrorApi(
      respuesta.status,
      mensaje,
      typeof cuerpo.accion === "string" ? cuerpo.accion : null,
      cuerpo,
    );
  }

  return cuerpo as T;
}
