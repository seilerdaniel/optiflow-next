"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MetricasDashboard } from "@/lib/metricas-db";

/*
 * Month-to-date metres vs. the monthly goal.
 *
 * A cumulative line chart instead of a plain gauge: it answers the only two
 * questions the plant actually asks — "are we on pace?" and "which day did we
 * fall behind?". The dashed line is the ideal pace (`goal / days in month`)
 * accumulated day by day; the solid line is what the cutting sector really
 * delivered, credited to the day each order entered or finished cutting.
 *
 * Client Component because of Recharts; the series arrives ready from the
 * Server Component, so there is no client-side fetch.
 */

const formateador = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

export default function GraficoMetros({ metros }: { metros: MetricasDashboard["metros"] }) {
  const serie = metros.serie;
  const porcentaje = metros.porcentaje ?? 0;
  const avance = Math.min(100, Math.max(0, porcentaje));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-xs tabular-nums text-white/60">
          <span className="text-lg font-semibold text-white">
            {formateador.format(metros.total)}
          </span>{" "}
          / {formateador.format(metros.meta_total)} m
        </p>
        <p
          className={`font-mono text-xs tabular-nums ${
            porcentaje >= 100 ? "text-cian" : porcentaje >= 70 ? "text-proceso" : "text-pausa"
          }`}
        >
          {metros.porcentaje === null ? "sin meta" : `${porcentaje.toFixed(1)} %`}
        </p>
      </div>

      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-industrial"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(avance)}
        aria-label="Cumplimiento de la meta mensual de metros"
      >
        <div
          className={`h-full rounded-full ${porcentaje >= 100 ? "bg-cian" : "bg-placares"}`}
          style={{ width: `${avance}%` }}
        />
      </div>

      {serie.length === 0 ? (
        <p className="flex h-[180px] items-center justify-center text-xs text-white/35">
          Todavía no hay cortes registrados en el mes.
        </p>
      ) : (
        <div className="h-[180px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={serie} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="#ffffff10" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="dia"
                tick={{ fill: "#ffffff66", fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: "#ffffff20" }}
                minTickGap={16}
              />
              <YAxis
                tick={{ fill: "#ffffff66", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                unit=" m"
              />
              <Tooltip
                contentStyle={{
                  background: "#1e2124",
                  border: "1px solid #3f4248",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "#ffffff",
                }}
                labelStyle={{ color: "#ffffff99", fontSize: 11 }}
              />
              <Line
                type="monotone"
                dataKey="ideal"
                name="Ideal acumulado"
                stroke="#ffffff40"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                unit=" m"
              />
              <Line
                type="monotone"
                dataKey="acumulado"
                name="Acumulado real"
                stroke="#22B8CF"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3, fill: "#22B8CF" }}
                unit=" m"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {metros.por_linea.length > 0 ? (
        <ul className="flex flex-col gap-2 border-t border-border pt-3">
          {metros.por_linea.map((linea) => {
            const color = linea.linea === "Placares" ? "bg-placares" : "bg-cocinas";
            const porcentajeLinea = Math.min(100, Math.max(0, linea.porcentaje ?? 0));

            return (
              <li key={linea.linea} className="flex flex-col gap-1">
                <div className="flex items-center justify-between font-mono text-[10px] tabular-nums text-white/45">
                  <span className="flex items-center gap-1.5 uppercase tracking-[0.1em]">
                    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${color}`} />
                    {linea.linea}
                  </span>
                  <span>
                    {formateador.format(linea.cortados)} / {formateador.format(linea.meta)} m
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-industrial">
                  <div
                    className={`h-full rounded-full ${color}`}
                    style={{ width: `${porcentajeLinea}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
