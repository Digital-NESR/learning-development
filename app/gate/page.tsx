import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GATE_COOKIE, GATE_MAX_AGE, gatePassed, gateToken, safeEqual, sitePassword } from "@/lib/site-gate";

export const dynamic = "force-dynamic";

const green = "#2A7E4F";

/** Only allow redirects back into this site. */
const safeNext = (n: unknown) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") ? n : "/");

export default async function GatePage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  if (await gatePassed((await cookies()).get(GATE_COOKIE)?.value)) redirect(safeNext(next));

  async function unlock(formData: FormData) {
    "use server";
    const dest = safeNext(formData.get("next"));
    const entered = String(formData.get("password") || "");
    if (!sitePassword() || !safeEqual(entered, sitePassword())) {
      await new Promise(r => setTimeout(r, 1000)); // slow down guessing
      redirect("/gate?error=1&next=" + encodeURIComponent(dest));
    }
    (await cookies()).set(GATE_COOKIE, await gateToken(), {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: GATE_MAX_AGE
    });
    redirect(dest);
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "#F2F4F3" }}>
      <div style={{ width: "100%", maxWidth: 420, background: "#fff", border: "1px solid #E1E5E3", borderRadius: 7, overflow: "hidden", boxShadow: "0 12px 40px rgba(31,31,29,.08)" }}>
        <div style={{ background: green, padding: "22px 24px", display: "flex", alignItems: "center", gap: 16 }}>
          <img src="/assets/nesr-logo-white.png" alt="NESR" style={{ height: 34, width: "auto" }} />
          <div style={{ width: 1, height: 28, background: "rgba(255,255,255,.35)" }} />
          <div style={{ color: "#fff", fontSize: 15, fontWeight: "bold" }}>Learning &amp; Development Portal</div>
        </div>
        <form action={unlock} style={{ padding: "26px 24px" }}>
          <div style={{ fontSize: 20, fontWeight: "bold" }}>Restricted access</div>
          <div style={{ fontSize: 13, color: "#58595B", marginTop: 4, marginBottom: 18 }}>This site is in testing. Enter the access password to continue.</div>
          {error && (
            <div style={{ background: "#F7DEDE", color: "#8A2B2B", fontSize: 12, padding: "9px 12px", borderRadius: 4, marginBottom: 14 }}>
              Incorrect password. Try again.
            </div>
          )}
          <input type="hidden" name="next" value={safeNext(next)} />
          <label htmlFor="password" style={{ display: "block", fontSize: 10, fontWeight: "bold", letterSpacing: ".7px", textTransform: "uppercase", color: "#58595B", marginBottom: 4 }}>Access password</label>
          <input id="password" name="password" type="password" required autoFocus autoComplete="current-password"
            style={{ width: "100%", padding: "10px 12px", border: "1px solid #D1D3D4", borderRadius: 4, marginBottom: 14 }} />
          <button type="submit" style={{ width: "100%", padding: "11px 14px", border: 0, borderRadius: 4, background: green, color: "#fff", fontWeight: "bold", fontSize: 14, cursor: "pointer" }}>
            Continue
          </button>
          <div style={{ fontSize: 11, color: "#58595B", marginTop: 18 }}>
            Don&apos;t have the password? Contact the L&amp;D team at <a href="mailto:learning@nesr.com">learning@nesr.com</a>
          </div>
        </form>
      </div>
    </div>
  );
}
