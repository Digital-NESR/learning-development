import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "./auth.config";
import { prisma } from "@/lib/prisma";
import { USER_FIELDS, emailOf, graphGet, locationOf, managerByAppToken, saveManager, type GraphUser } from "@/lib/graph";

/** Entra ID App Role value that grants the L&D Team (admin) workspace. */
export const ADMIN_ROLE = process.env.LD_ADMIN_ROLE || "LD.Admin";

export const demoLoginEnabled = process.env.LD_DEMO_LOGIN === "true";

/** Creates or refreshes the signed-in person, and their manager, from Entra ID claims + Microsoft Graph. */
async function syncEmployee(claims: Record<string, unknown>, accessToken?: string) {
  const me = accessToken ? await graphGet<GraphUser>(`/me?$select=${USER_FIELDS}`, accessToken, "delegated /me") : null;
  // Manager: the user's own token first; if that isn't allowed, the app's own permission (if IT granted one).
  const oid = String(claims.oid || me?.id || "");
  const mgr = (accessToken ? await graphGet<GraphUser>(`/me/manager?$select=${USER_FIELDS}`, accessToken, "delegated /me/manager") : null)
    || (oid ? await managerByAppToken(oid) : null);

  const email = String(me ? emailOf(me) : claims.email || claims.preferred_username || "").toLowerCase();
  if (!email) throw new Error("Entra ID did not return an email for this user");

  const roles = Array.isArray(claims.roles) ? (claims.roles as string[]) : [];
  const bootstrapAdmins = (process.env.LD_ADMIN_EMAILS || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  const isAdmin = roles.includes(ADMIN_ROLE) || bootstrapAdmins.includes(email);

  const name = me?.displayName || String(claims.name || email);
  const firstName = me?.givenName || String(claims.given_name || name.split(" ")[0]);

  const managerId = mgr ? await saveManager(mgr, email) : null;
  if (!mgr) console.warn("[sso] no manager found for a signed-in user (none set in Entra ID, or Graph permission missing)");

  const data = {
    entraOid: String(claims.oid || me?.id || "") || null,
    name, firstName,
    title: me?.jobTitle ?? null,
    department: me?.department ?? null,
    nesrId: me?.employeeId ?? null,
    country: me?.country ?? null,
    location: me ? locationOf(me) : null,
    isAdmin,
    lastLoginAt: new Date(),
    ...(managerId ? { managerId } : {})
  };
  return prisma.employee.upsert({ where: { email }, update: data, create: { email, ...data } });
}

const env = process.env;

const providers: Provider[] = [
  MicrosoftEntraID({
    // Digital-NESR shared AZURE_AD_* variables; LD_AZURE_AD_* override them if L&D gets its own app registration.
    clientId: env.LD_AZURE_AD_CLIENT_ID || env.AZURE_AD_CLIENT_ID,
    clientSecret: env.LD_AZURE_AD_CLIENT_SECRET || env.AZURE_AD_CLIENT_SECRET,
    issuer: `https://login.microsoftonline.com/${env.LD_AZURE_AD_TENANT_ID || env.AZURE_AD_TENANT_ID || "common"}/v2.0`,
    // ".default" = every delegated Graph permission IT has granted (e.g. to read the user's manager)
    authorization: { params: { scope: "openid profile email https://graph.microsoft.com/.default" } }
  })
];

if (demoLoginEnabled) {
  providers.push(
    Credentials({
      id: "demo",
      name: "Demo login",
      credentials: { email: {} },
      async authorize(creds) {
        const email = String(creds?.email || "").toLowerCase();
        if (!email.endsWith("@demo.nesr.com")) return null;
        const emp = await prisma.employee.findUnique({ where: { email } });
        return emp ? { id: emp.id, email: emp.email, name: emp.name } : null;
      }
    })
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers,
  callbacks: {
    async jwt({ token, account, profile, user }) {
      if (account?.provider === "microsoft-entra-id") {
        const emp = await syncEmployee({ ...(profile || {}) }, account.access_token);
        token.employeeId = emp.id;
      } else if (account?.provider === "demo" && user?.id) {
        token.employeeId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.employeeId) (session.user as { employeeId?: string }).employeeId = token.employeeId as string;
      return session;
    }
  }
});

/** The signed-in employee record, or null. */
export async function currentEmployee() {
  const session = await auth();
  const id = (session?.user as { employeeId?: string } | undefined)?.employeeId;
  if (!id) return null;
  return prisma.employee.findUnique({ where: { id } });
}
