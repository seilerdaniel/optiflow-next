import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

/*
 * Perimeter session check.
 *
 * `middleware.ts` was renamed to `proxy.ts` in Next.js 16; the function is
 * `proxy` and it runs on the Node.js runtime by default.
 *
 * This is an OPTIMISTIC check: it only looks at the presence of the cookie to
 * avoid a database round-trip on every request. Real authorisation still has to
 * happen where data is read or written (route handlers, server components).
 */
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/login") {
    return NextResponse.next();
  }

  if (request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: [
    /*
     * Everything is protected except:
     * - api        → route handlers validate their own session
     * - login      → public entry point
     * - _next/*    → build assets and image optimisation
     * - favicon.ico
     */
    "/((?!api|login|_next/static|_next/image|favicon.ico).*)",
  ],
};
