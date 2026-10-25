import {
  fechaHoraLocal,
  minutosLegibles,
  type EstadoEtapa,
  type RegistroTiempo,
} from "@/lib/produccion";

/*
 * Stage history for one order.
 *
 * Real `<table>` from `md` up (the office compares columns), stacked cards on
 * phones. Duration is net of pauses: `duracion_minutos` already discounts them.
 */

const ESTADO: Record<EstadoEtapa, string> = {
  "En Proceso": "border-proceso/40 bg-proceso/15 text-proceso",
  Pausado: "border-pausa/40 bg-pausa/15 text-pausa",
  Finalizado: "border-border bg-white/5 text-white/50",
};

function duracion(registro: RegistroTiempo): string {
  if (registro.duracion_minutos === null) return "en curso";
  return minutosLegibles(registro.duracion_minutos);
}

function pausa(registro: RegistroTiempo): string | null {
  if (registro.segundos_pausados <= 0) return null;
  return minutosLegibles(registro.segundos_pausados / 60);
}

export default function TablaRegistros({ registros }: { registros: RegistroTiempo[] }) {
  if (registros.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/60">
          Registros de tiempo
        </h2>
        <p className="text-sm text-white/40">
          Todavía no hay fichados para esta OT.
        </p>
      </div>
    );
  }

  const total = Math.round(
    registros.reduce((suma, registro) => suma + (registro.duracion_minutos ?? 0), 0) * 10,
  ) / 10;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/60">
            Registros de tiempo
          </h2>
          <p className="mt-1 text-xs text-white/40">
            {registros.length} fichado(s) · {minutosLegibles(total)} netos acumulados.
          </p>
        </div>
      </header>

      {/* Phones: stacked cards */}
      <ul className="flex flex-col gap-2 md:hidden">
        {registros.map((registro) => (
          <li key={registro.id} className="rounded-lg border border-border bg-industrial/40 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {registro.nombre_sector ?? `Sector #${registro.sector_id}`}
                </p>
                <p className="mt-0.5 truncate text-xs text-white/45">
                  {registro.operario_nombre}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${ESTADO[registro.estado_etapa]}`}
              >
                {registro.estado_etapa}
              </span>
            </div>

            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums text-white/50">
              <div>
                <dt className="text-white/30">Inicio</dt>
                <dd>{fechaHoraLocal(registro.fecha_hora_inicio)}</dd>
              </div>
              <div>
                <dt className="text-white/30">Fin</dt>
                <dd>{fechaHoraLocal(registro.fecha_hora_fin)}</dd>
              </div>
              <div>
                <dt className="text-white/30">Duración</dt>
                <dd className={registro.duracion_minutos === null ? "text-proceso" : ""}>
                  {duracion(registro)}
                </dd>
              </div>
              {pausa(registro) ? (
                <div>
                  <dt className="text-white/30">Pausas</dt>
                  <dd className="text-pausa">{pausa(registro)}</dd>
                </div>
              ) : null}
            </dl>

            {registro.observacion ? (
              <p className="mt-2 border-t border-border/70 pt-2 text-xs text-white/40">
                {registro.observacion}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      {/* Tablets and up: real table */}
      <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-industrial/60 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">
              <th scope="col" className="px-3 py-2.5">Sector</th>
              <th scope="col" className="px-3 py-2.5">Operario</th>
              <th scope="col" className="px-3 py-2.5">Inicio</th>
              <th scope="col" className="px-3 py-2.5">Fin</th>
              <th scope="col" className="px-3 py-2.5 text-right">Duración</th>
              <th scope="col" className="px-3 py-2.5">Estado</th>
              <th scope="col" className="px-3 py-2.5">Observación</th>
            </tr>
          </thead>
          <tbody>
            {registros.map((registro) => (
              <tr
                key={registro.id}
                className="border-b border-border/60 last:border-0 hover:bg-white/[0.03]"
              >
                <td className="px-3 py-2.5">
                  <span className="block">
                    {registro.nombre_corto ?? registro.nombre_sector ?? `Sector #${registro.sector_id}`}
                  </span>
                  <span className="block text-[11px] text-white/35">
                    {registro.nombre_sector ?? ""}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-white/80">{registro.operario_nombre}</td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs tabular-nums text-white/60">
                  {fechaHoraLocal(registro.fecha_hora_inicio)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs tabular-nums text-white/60">
                  {fechaHoraLocal(registro.fecha_hora_fin)}
                </td>
                <td
                  className={`whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs tabular-nums ${
                    registro.duracion_minutos === null ? "text-proceso" : "text-white/80"
                  }`}
                >
                  {duracion(registro)}
                  {pausa(registro) ? (
                    <span className="ml-1 text-[10px] text-pausa">+{pausa(registro)} pausa</span>
                  ) : null}
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={`inline-block rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${ESTADO[registro.estado_etapa]}`}
                  >
                    {registro.estado_etapa}
                  </span>
                </td>
                <td className="max-w-[220px] px-3 py-2.5 text-xs text-white/45">
                  <span className="line-clamp-2">{registro.observacion ?? "—"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
