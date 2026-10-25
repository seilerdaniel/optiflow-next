import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sectores — OptiFlow",
};

export default function SectoresPage() {
  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">Sectores</h1>
      <p className="max-w-prose text-sm text-white/50">
        Catálogo de sectores y flujos de producción por línea.
      </p>
    </section>
  );
}
