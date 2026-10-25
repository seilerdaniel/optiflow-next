"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type LoginResponse = {
  ok?: boolean;
  error?: string;
};

export default function LoginForm() {
  const router = useRouter();
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSending(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, password }),
      });

      const payload = (await response.json().catch(() => null)) as LoginResponse | null;

      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? "No se pudo iniciar sesión. Intente nuevamente.");
        return;
      }

      // The proxy reads the session cookie on the server, so refresh the tree
      // instead of only changing the client route.
      router.replace("/");
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor. Verifique la red.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="usuario"
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40"
        >
          Usuario
        </label>
        <input
          id="usuario"
          name="usuario"
          type="text"
          required
          autoComplete="username"
          spellCheck={false}
          value={usuario}
          onChange={(event) => setUsuario(event.target.value)}
          className="h-11 rounded border border-border bg-industrial px-3 text-sm text-white outline-none transition-colors placeholder:text-white/25 focus:border-cian"
          placeholder="usuario"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="password"
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40"
        >
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-11 rounded border border-border bg-industrial px-3 text-sm text-white outline-none transition-colors placeholder:text-white/25 focus:border-cian"
          placeholder="••••••••"
        />
      </div>

      {error && (
        <p
          role="alert"
          className="rounded border border-alerta/40 bg-alerta/10 px-3 py-2 text-xs text-alerta"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={sending}
        className="mt-1 h-11 rounded bg-cian text-sm font-semibold text-industrial transition-colors hover:bg-cian/85 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {sending ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}
