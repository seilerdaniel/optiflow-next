import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import DetalleOT from "@/components/ordenes/DetalleOT";
import { obtenerOrden } from "@/lib/produccion-db";
import { sesionActual } from "@/lib/session-server";

/*
 * Order detail (office technical department).
 *
 * The whole screen is rendered from `obtenerOrden` (three round trips) and
 * handed to the client shell. The QR needs an absolute origin, so it is built
 * here from the request headers: the plant tablet must be able to resolve the
 * same URL the office prints.
 */

export const metadata: Metadata = {
  title: "Detalle de OT — OptiFlow",
};

type Parametros = Promise<{ id: string }>;

/**
 * Public origin of the app, as seen by the browser that loaded this page.
 * `NEXT_PUBLIC_APP_URL` wins when the deployment sits behind a proxy that does
 * not forward host/proto.
 */
async function origenPublico(): Promise<string> {
  const configurado = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configurado) return configurado.replace(/\/+$/, "");

  const cabeceras = await headers();
  const host = cabeceras.get("x-forwarded-host") ?? cabeceras.get("host") ?? "localhost:3000";
  const protocolo =
    cabeceras.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");

  return `${protocolo}://${host}`;
}

function DetalleSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="h-5 w-36 animate-pulse rounded bg-card" />
      <div className="h-56 animate-pulse rounded-xl border border-border bg-card" />
      <div className="h-11 animate-pulse rounded-lg border border-border bg-card" />
      <div className="h-72 animate-pulse rounded-lg border border-border bg-card" />
    </div>
  );
}

async function Contenido({ params }: { params: Parametros }) {
  if (!(await sesionActual())) redirect("/login");

  const { id } = await params;
  const otId = Number(id);

  if (!Number.isInteger(otId) || otId <= 0) notFound();

  const detalle = await obtenerOrden(otId);
  if (!detalle) notFound();

  const qrBase = await origenPublico();

  return <DetalleOT cliente={detalle} qrBase={qrBase} />;
}

export default function DetalleOrdenPage({ params }: { params: Parametros }) {
  return (
    <Suspense fallback={<DetalleSkeleton />}>
      <Contenido params={params} />
    </Suspense>
  );
}
