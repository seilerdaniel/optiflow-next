"use client";

import { Suspense, useState, type ReactNode } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

/*
 * The sidebar reads `usePathname()` to highlight the active section. On routes
 * whose dynamic param is unknown at build time (`/ordenes/[id]`) that hook can
 * only resolve at request time, so it must sit inside a `Suspense` boundary or
 * it would block prerendering of the whole layout. The fallback reserves the
 * same column so nothing shifts while it streams in.
 */
function SidebarFallback() {
  return (
    <aside
      aria-hidden="true"
      className="fixed inset-y-0 left-0 z-40 hidden w-[260px] border-r border-border bg-industrial md:block"
    />
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-industrial">
      <Suspense fallback={<SidebarFallback />}>
        <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      </Suspense>
      <div className="flex min-h-screen w-full flex-col md:pl-[260px]">
        <Topbar navOpen={navOpen} onToggleNav={() => setNavOpen((open) => !open)} />
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
