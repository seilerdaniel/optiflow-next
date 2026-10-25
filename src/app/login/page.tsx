import type { Metadata } from "next";
import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "Ingreso — OptiFlow",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded bg-cian/15 font-mono text-sm font-bold text-cian">
            OF
          </span>
          <div className="flex flex-col leading-tight">
            <span className="text-lg font-semibold tracking-tight">OptiFlow</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
              Control de planta
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-6">
          <h1 className="mb-1 text-base font-semibold">Ingreso al sistema</h1>
          <p className="mb-5 text-xs text-white/45">
            Acceso restringido al personal de planta.
          </p>
          <LoginForm />
        </div>

        <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-white/25">
          OptiFlow · Producción
        </p>
      </div>
    </main>
  );
}
