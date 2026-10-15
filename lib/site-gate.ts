// Optional site-wide access password (LD_SITE_PASSWORD), checked before sign-in.
// Edge-safe: used by middleware and by the /gate server action.
// The cookie holds an HMAC of the password, never the password, so changing the password logs everyone out of the gate.

export const GATE_COOKIE = "ld_site_access";
export const GATE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

export const sitePassword = () => process.env.LD_SITE_PASSWORD || "";

async function hmac(message: string) {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "ld-portal";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, "0")).join("");
}

/** Cookie value that proves the current password was entered. */
export const gateToken = () => hmac("site-gate:" + sitePassword());

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True if the gate is off, or the cookie matches the current password. */
export async function gatePassed(cookieValue: string | undefined) {
  if (!sitePassword()) return true;
  return !!cookieValue && safeEqual(cookieValue, await gateToken());
}
