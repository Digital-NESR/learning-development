import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

export default auth(req => {
  const { pathname } = req.nextUrl;

  // Everything except the login page needs a signed-in session
  if (!req.auth?.user && !pathname.startsWith("/login")) {
    const url = new URL("/login", req.nextUrl);
    url.searchParams.set("callbackUrl", req.nextUrl.href);
    return NextResponse.redirect(url);
  }
});

export const config = {
  // Everything except auth endpoints (Microsoft returns there), key-protected automation hooks, Next internals and static files.
  matcher: ["/((?!api/auth|api/hooks|_next/static|_next/image|assets|favicon.ico).*)"]
};
