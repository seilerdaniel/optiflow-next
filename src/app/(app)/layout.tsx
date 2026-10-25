import AppShell from "@/components/layout/AppShell";

/*
 * Application shell layout for every authenticated screen.
 *
 * It lives in a route group so /login can render without the sidebar and
 * topbar while keeping the same URLs: (app)/page.tsx is still "/".
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
