import "server-only";
import { prisma } from "@/lib/prisma";

// Microsoft Graph helpers: profile and line manager.
// Two ways in: the signed-in user's delegated token, or the app's own token (client credentials),
// depending on whether IT granted Delegated or Application permissions.

const GRAPH = "https://graph.microsoft.com/v1.0";
export const USER_FIELDS = "id,displayName,givenName,surname,mail,userPrincipalName,jobTitle,department,employeeId,country,officeLocation,city";

export type GraphUser = {
  id: string; displayName?: string; givenName?: string; surname?: string; mail?: string; userPrincipalName?: string;
  jobTitle?: string; department?: string; employeeId?: string; country?: string; officeLocation?: string; city?: string;
};

const env = process.env;
const tenant = () => env.LD_AZURE_AD_TENANT_ID || env.AZURE_AD_TENANT_ID || "";
const clientId = () => env.LD_AZURE_AD_CLIENT_ID || env.AZURE_AD_CLIENT_ID || "";
const clientSecret = () => env.LD_AZURE_AD_CLIENT_SECRET || env.AZURE_AD_CLIENT_SECRET || "";

/** GET from Graph. Returns null on 404 (e.g. no manager set); logs other failures without exposing tokens. */
export async function graphGet<T>(path: string, token: string, label: string): Promise<T | null> {
  try {
    const res = await fetch(GRAPH + path, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (res.ok) return (await res.json()) as T;
    if (res.status !== 404) {
      const body = await res.text().catch(() => "");
      const code = body.match(/"code"\s*:\s*"([^"]+)"/)?.[1] || "";
      console.warn(`[graph] ${label} failed: HTTP ${res.status} ${code}`);
    }
    return null;
  } catch (e) {
    console.warn(`[graph] ${label} failed: ${(e as Error).message}`);
    return null;
  }
}

let appToken: { value: string; expires: number } | null = null;

/** App-only token (client credentials). Works only if IT granted an Application permission such as User.Read.All. */
async function getAppToken(): Promise<string | null> {
  if (appToken && appToken.expires > Date.now() + 60_000) return appToken.value;
  if (!tenant() || !clientId() || !clientSecret()) return null;
  try {
    const res = await fetch(`https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId(), client_secret: clientSecret(), scope: "https://graph.microsoft.com/.default" }),
      cache: "no-store"
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) {
      console.warn(`[graph] app token failed: HTTP ${res.status} ${j.error || ""}`);
      return null;
    }
    appToken = { value: j.access_token, expires: Date.now() + (Number(j.expires_in) || 3000) * 1000 };
    return appToken.value;
  } catch (e) {
    console.warn(`[graph] app token failed: ${(e as Error).message}`);
    return null;
  }
}

/** A user's line manager by Entra object id, using the app's own permissions. */
export async function managerByAppToken(oid: string): Promise<GraphUser | null> {
  const token = await getAppToken();
  if (!token) return null;
  return graphGet<GraphUser>(`/users/${encodeURIComponent(oid)}/manager?$select=${USER_FIELDS}`, token, "app /users/{id}/manager");
}

export const emailOf = (u: GraphUser) => (u.mail || u.userPrincipalName || "").toLowerCase();
export const locationOf = (u: GraphUser) => u.officeLocation || [u.city, u.country].filter(Boolean).join(", ") || null;

/** Saves the manager as an employee record (creating or refreshing it) and returns its id. */
export async function saveManager(mgr: GraphUser, ownEmail: string): Promise<string | null> {
  const mgrEmail = emailOf(mgr);
  if (!mgrEmail || mgrEmail === ownEmail) return null;
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
  return m.id;
}

/**
 * Fills in a missing line manager for an employee, using the app's own Graph access.
 * Cheap no-op when the manager is already known or the person didn't sign in with Microsoft.
 */
export async function ensureManager(emp: { id: string; email: string; entraOid: string | null; managerId: string | null }) {
  if (emp.managerId || !emp.entraOid) return emp.managerId;
  const mgr = await managerByAppToken(emp.entraOid);
  if (!mgr) return null;
  const managerId = await saveManager(mgr, emp.email);
  if (managerId) await prisma.employee.update({ where: { id: emp.id }, data: { managerId } });
  return managerId;
}
