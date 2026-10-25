"use client";

import { useSyncExternalStore } from "react";

const DATE_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "short",
});

function formatDate(date: Date) {
  const formatted = DATE_FORMATTER.format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function formatShortDate(date: Date) {
  return SHORT_DATE_FORMATTER.format(date).replace(".", "");
}

/*
 * The current date is external, non-React state: it cannot be computed during
 * render (the layout is prerendered, so it would freeze the build date) and it
 * cannot be set from an effect (cascading renders). A tiny external store keeps
 * it correct across midnight shifts without breaking hydration.
 */
let currentDate = new Date();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);

  if (listeners.size === 1) {
    timer = setInterval(() => {
      const next = new Date();
      if (next.toDateString() === currentDate.toDateString()) return;

      currentDate = next;
      listeners.forEach((notify) => notify());
    }, 60_000);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => currentDate;
const getServerSnapshot = (): Date | null => null;

export default function Topbar({
  navOpen,
  onToggleNav,
}: {
  navOpen: boolean;
  onToggleNav: () => void;
}) {
  const today = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
      <button
        type="button"
        onClick={onToggleNav}
        aria-expanded={navOpen}
        aria-controls="app-sidebar"
        aria-label="Alternar menú de navegación"
        className="-ml-1 flex h-9 w-9 items-center justify-center rounded text-white/70 transition-colors hover:bg-industrial hover:text-white md:hidden"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          className="h-5 w-5"
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      <div className="flex-1" />

      <time className="font-mono text-[11px] uppercase tracking-wide text-white/50 sm:hidden">
        {today ? formatShortDate(today) : ""}
      </time>

      <time className="hidden font-mono text-[11px] uppercase tracking-wide text-white/50 sm:block">
        {today ? formatDate(today) : ""}
      </time>

      <span aria-hidden="true" className="hidden h-6 w-px bg-border sm:block" />

      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cian/15 text-[11px] font-semibold text-cian ring-1 ring-cian/40">
          AD
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-xs font-medium text-white/90">Admin</span>
          <span className="text-[10px] uppercase tracking-wide text-white/40">
            Administrador
          </span>
        </span>
      </div>
    </header>
  );
}
