"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  tiempoSugeridoOT,
  type DetalleOrden,
  type MaterialOT,
  type ResumenMateriales,
} from "@/lib/produccion";
import HeroCardOT from "./HeroCardOT";
import TabsDetalle from "./TabsDetalle";

/*
 * Client shell of the order detail.
 *
 * The server ships the initial snapshot (`cliente`) and this component owns the
 * live copy: the configuration tab can replace the whole snapshot (the PATCH
 * returns it) and the materials tab merges the recomputed consumption totals.
 * Everything below the hero card reads from that single state, so the four tabs
 * can never disagree with each other.
 */

export default function DetalleOT({
  cliente,
  qrBase,
}: {
  cliente: DetalleOrden;
  qrBase: string;
}) {
  const [detalle, setDetalle] = useState<DetalleOrden>(cliente);
  const { ot, registros, sectores } = detalle;

  const qrSrc = useMemo(() => {
    const destino = `${qrBase}/?ot=${ot.numero_ot}`;
    return (
      "https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=" +
      encodeURIComponent(destino)
    );
  }, [qrBase, ot.numero_ot]);

  const tiempoSugerido = useMemo(() => tiempoSugeridoOT(ot, sectores), [ot, sectores]);

  function actualizarMateriales(materiales: MaterialOT[], resumen: ResumenMateriales) {
    setDetalle((previo) => ({
      ...previo,
      ot: { ...previo.ot, materiales, resumen_materiales: resumen },
    }));
  }

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Migas de pan" className="flex items-center justify-between gap-3">
        <Link
          href="/ordenes"
          className="text-xs text-white/50 underline-offset-2 transition-colors hover:text-white hover:underline"
        >
          ← Volver a órdenes
        </Link>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/30">
          Oficina técnica
        </span>
      </nav>

      <HeroCardOT ot={ot} qrSrc={qrSrc} tiempoSugerido={tiempoSugerido} />

      <TabsDetalle
        ot={ot}
        registros={registros}
        sectores={sectores}
        onActualizada={setDetalle}
        onMateriales={actualizarMateriales}
      />
    </div>
  );
}
