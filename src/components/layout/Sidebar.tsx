"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
};

const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Terminal",
    hint: "Fichaje en planta",
    icon: (
      <path
        d="m4 6 4 4-4 4m6 0h6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    href: "/ordenes",
    label: "Órdenes",
    hint: "Seguimiento de OT",
    icon: (
      <path
        d="M8 4h8a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 5h6M9 13h6M9 17h3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    href: "/sectores",
    label: "Sectores",
    hint: "Placares, cocinas y compartidos",
    icon: (
      <path
        d="M4 8.5 12 4l8 4.5-8 4.5-8-4.5Zm0 7L12 20l8-4.5M4 12l8 4.5 8-4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
];

const LINES = [
  { label: "Placares", color: "bg-placares" },
  { label: "Cocinas", color: "bg-cocinas" },
  { label: "Compartidos", color: "bg-compartidos" },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export default function Sidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Cerrar menú de navegación"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
        />
      )}

      <aside
        id="app-sidebar"
        aria-label="Navegación principal"
        className={`fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col border-r border-border bg-industrial transition-transform duration-200 ease-out md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
          <span className="flex h-8 w-8 items-center justify-center rounded bg-cian/15 font-mono text-sm font-bold text-cian">
            OF
          </span>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-wide">OptiFlow</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
              Planta
            </span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-3">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 border-l-4 px-5 py-3 transition-colors ${
                  active
                    ? "border-cian bg-card text-white"
                    : "border-transparent text-white/60 hover:border-cian hover:bg-card hover:text-white"
                }`}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  className={`h-4 w-4 shrink-0 ${active ? "text-cian" : ""}`}
                >
                  {item.icon}
                </svg>
                <span className="flex flex-col leading-tight">
                  <span className="text-sm font-medium">{item.label}</span>
                  <span className="text-[11px] text-white/40">{item.hint}</span>
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-border px-5 py-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
            Líneas
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {LINES.map((line) => (
              <li
                key={line.label}
                className="flex items-center gap-2 text-xs text-white/60"
              >
                <span className={`h-2 w-2 rounded-full ${line.color}`} />
                {line.label}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </>
  );
}
