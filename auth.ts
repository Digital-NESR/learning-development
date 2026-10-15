import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "./auth.config";
import { prisma } from "@/lib/prisma";

/** Entra ID App Role value that grants the L&D Team (admin) workspace. */
export const ADMIN_ROLE = process.env.LD_ADMIN_ROLE || "LD.Admin";

export const demoLoginEnabled = process.env.LD_DEMO_LOGIN === "true";

const GRAPH = "https://graph.microsoft.com/v1.0";
const USER_FIELDS = "id,displayName,givenName,surname,mail,userPrincipalName,jobTitle,department,employeeId,country,officeLocation,city";

type GraphUser = {
  id: string; displayName?: string; givenName?: string; surname?: string; mail?: string; userPrincipalName?: string;
  jobTitle?: string; department?: string; employeeId?: string; country?: string; officeLocation?: string; city?: string;
};

async function graph<T>(path: string, accessToken: string): Promise<T | null> {
  try {
    const res = await fetch(GRAPH + path, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

const emailOf = (u: GraphUser) => (u.mail || u.userPrincipalName || "").toLowerCase();
const locationOf = (u: GraphUser) => u.officeLocation || [u.city, u.country].filter(Boolean).join(", ") || null;

/** Creates or refreshes the signed-in person, and their manager, from Entra ID claims + Microsoft Graph. */
async function syncEmployee(claims: Record<string, unknown>, accessToken?: string) {
  const me = accessToken ? await graph<GraphUser>(`/me?$select=${USER_FIELDS}`, accessToken) : null;
  const mgr = accessToken ? await graph<GraphUser>(`/me/manager?$select=${USER_FIELDS}`, accessToken) : null;

  const email = String(me ? emailOf(me) : claims.email || claims.preferred_username || "").toLowerCase();
  if (!email) throw new Error("Entra ID did not return an email for this user");

  const roles = Array.isArray(claims.roles) ? (claims.roles as string[]) : [];
  const bootstrapAdmins = (process.env.LD_ADMIN_EMAILS || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  const isAdmin = roles.includes(ADMIN_ROLE) || bootstrapAdmins.includes(email);

  const name = me?.displayName || String(claims.name || email);
  const firstName = me?.givenName || String(claims.given_name || name.split(" ")[0]);

  let managerId: string | undefined;
  const mgrEmail = mgr ? emailOf(mgr) : "";
  if (mgr && mgrEmail && mgrEmail !== email) {
    const mgrData = {
      name: mgr.displayName || mgrEmail, firstName: mgr.givenName || (mgr.displayName || mgrEmail).split(" ")[0],
      title: mgr.jobTitle || null, department: mgr.department || null, nesrId: mgr.employeeId || null,
      location: locationOf(mgr), country: mgr.country || null
    };
    const m = await prisma.employee.upsert({
      where: { email: mgrEmail },
      update: mgrData,
      create: { email: mgrEmail, entraOid: mgr.id, ...mgrData }
    });
    managerId = m.id;
  }

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
    authorization: { params: { scope: "openid profile email User.Read" } }
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
    ...authConfig.callbacks,
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
