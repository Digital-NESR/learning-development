import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";
import { GATE_COOKIE, gatePassed } from "./lib/site-gate";

const { auth } = NextAuth(authConfig);

export default auth(async req => {
  const { pathname, search } = req.nextUrl;

  // 1. Site access password (only when LD_SITE_PASSWORD is set)
  if (pathname !== "/gate" && !(await gatePassed(req.cookies.get(GATE_COOKIE)?.value))) {
    const url = new URL("/gate", req.nextUrl);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  // 2. Signed-in session for everything except the gate and login pages
  if (!req.auth?.user && pathname !== "/gate" && !pathname.startsWith("/login")) {
    const url = new URL("/login", req.nextUrl);
    url.searchParams.set("callbackUrl", req.nextUrl.href);
    return NextResponse.redirect(url);
  }
});

export const config = {
  // Everything except auth endpoints (Microsoft returns there), key-protected automation hooks, Next internals and static files.
  matcher: ["/((?!api/auth|api/hooks|_next/static|_next/image|assets|favicon.ico).*)"]
};
