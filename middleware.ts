import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Everything except auth endpoints, Next internals and static files requires a session.
  matcher: ["/((?!api/auth|_next/static|_next/image|assets|favicon.ico).*)"]
};
