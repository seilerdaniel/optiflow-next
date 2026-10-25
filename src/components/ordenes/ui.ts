import type { EstadoNodo, EstadoOT, LineaOT } from "@/lib/produccion";

/*
 * Shared visual vocabulary for the office screens.
 *
 * Plain data (no JSX, no hooks) so the same classes drive the server-rendered
 * list and the client-rendered detail. Colours come from the `@theme` block in
 * `globals.css`: placares / cocinas / proceso / pausa / alerta / cian.
 */

export const LINEA_BADGE: Record<LineaOT, string> = {
  Placares: "border-placares/50 bg-placares/15 text-white",
  Cocinas: "border-cocinas/50 bg-cocinas/15 text-white",
};

export const LINEA_PUNTO: Record<LineaOT, string> = {
  Placares: "bg-placares",
  Cocinas: "bg-cocinas",
};

export const ESTADO_OT_BADGE: Record<EstadoOT, string> = {
  "En Cola": "border-white/15 bg-white/5 text-white/60",
  "En Producción": "border-proceso/40 bg-proceso/15 text-proceso",
  Detenido: "border-pausa/40 bg-pausa/15 text-pausa",
  Finalizado: "border-cian/40 bg-cian/15 text-cian",
};

export const ESTADO_OT_PUNTO: Record<EstadoOT, string> = {
  "En Cola": "bg-white/40",
  "En Producción": "bg-proceso",
  Detenido: "bg-pausa",
  Finalizado: "bg-cian",
};

export const NODO_ESTILO: Record<
  EstadoNodo,
  { caja: string; etiqueta: string; icono: string }
> = {
  pendiente: {
    caja: "border-border bg-industrial/40",
    etiqueta: "Pendiente",
    icono: "⚪",
  },
  en_proceso: {
    caja: "border-proceso/50 bg-proceso/10",
    etiqueta: "En Proceso",
    icono: "🟡",
  },
  pausado: {
    caja: "border-pausa/50 bg-pausa/10",
    etiqueta: "Pausado",
    icono: "⏸️",
  },
  finalizado: {
    caja: "border-proceso/60 bg-proceso/15",
    etiqueta: "Finalizado",
    icono: "🟢",
  },
  bloqueado: {
    caja: "border-border bg-industrial/40 opacity-70",
    etiqueta: "Bloqueado",
    icono: "🔒",
  },
};

export const CAMPO =
  "min-h-[44px] w-full touch-manipulation rounded-lg border border-border bg-industrial px-3 text-sm text-white outline-none transition-colors placeholder:text-white/25 focus:border-cian";
