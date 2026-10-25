import type { Metadata } from "next";
import { Suspense } from "react";
import TerminalFichado from "@/components/terminal/TerminalFichado";

/*
 * Plant terminal — the app's home screen.
 *
 * `TerminalFichado` reads `?ot=` (the QR code carried on the order) through
 * `useSearchParams`, so it must sit inside a `Suspense` boundary: everything
 * around it can then be prerendered while the query string is resolved on the
 * client.
 */

export const metadata: Metadata = {
  title: "Terminal — OptiFlow",
};

function TerminalSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="h-16 w-64 animate-pulse rounded-lg bg-card" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-4">
          <div className="h-28 animate-pulse rounded-lg border border-border bg-card" />
          <div className="h-72 animate-pulse rounded-lg border border-border bg-card" />
        </div>
        <div className="flex flex-col gap-4">
          <div className="h-40 animate-pulse rounded-lg border border-border bg-card" />
          <div className="h-40 animate-pulse rounded-lg border border-border bg-card" />
        </div>
      </div>
    </div>
  );
}

export default function TerminalPage() {
  return (
    <Suspense fallback={<TerminalSkeleton />}>
      <TerminalFichado />
    </Suspense>
  );
}
