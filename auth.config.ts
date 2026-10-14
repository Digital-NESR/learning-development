import type { NextAuthConfig } from "next-auth";

// Edge-safe settings shared by middleware and the full auth setup in auth.ts.
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  trustHost: true,
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      if (pathname.startsWith("/login")) return true;
      return !!auth?.user;
    }
  }
} satisfies NextAuthConfig;
