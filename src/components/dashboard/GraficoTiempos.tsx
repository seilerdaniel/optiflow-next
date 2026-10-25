"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HorasSector } from "@/lib/metricas-db";

/*
 * Hours consumed per sector (last 30 days), as a horizontal bar chart.
 *
 * Client Component for one reason only: Recharts measures the container and
 * paints with canvas-less SVG on the client. The data is already aggregated on
 * the server, so this component never fetches anything.
 *
 * Colours follow the plant palette: Placares blue, Cocinas red, everything
 * shared or general in the cyan accent.
 */

const COLOR_LINEA: Record<string, string> = {
  Placares: "#1D63B8",
  Cocinas: "#C82333",
  Compartido: "#22B8CF",
  General: "#22B8CF",
};

const colorDe = (linea: string): string => COLOR_LINEA[linea] ?? "#22B8CF";

export default function GraficoTiempos({ datos }: { datos: HorasSector[] }) {
  if (datos.length === 0) {
    return (
      <p className="flex h-[280px] items-center justify-center text-xs text-white/35">
        Sin etapas cerradas en el período.
      </p>
    );
  }

  // The chart reads top-down; Recharts draws bottom-up for `layout="vertical"`.
  const series = [...datos].reverse().map((sector) => ({
    ...sector,
    sector: sector.nombre_corto || sector.nombre_sector,
  }));

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={series}
          layout="vertical"
          margin={{ top: 4, right: 16, bottom: 4, left: 4 }}
          barCategoryGap="22%"
        >
          <CartesianGrid stroke="#ffffff10" strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: "#ffffff66", fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: "#ffffff20" }}
            unit=" h"
          />
          <YAxis
            type="category"
            dataKey="sector"
            width={132}
            tick={{ fill: "#ffffff99", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            contentStyle={{
              background: "#1e2124",
              border: "1px solid #3f4248",
              borderRadius: 8,
              fontSize: 12,
              color: "#ffffff",
            }}
            labelStyle={{ color: "#ffffff99", fontSize: 11 }}
          />
          <Bar dataKey="horas" name="Horas" radius={[0, 4, 4, 0]} unit=" h">
            {series.map((sector) => (
              <Cell key={sector.sector_id} fill={colorDe(sector.linea_area)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
