import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { currentEmployee, signIn, demoLoginEnabled } from "@/auth";
import { DEMO_PEOPLE } from "@/lib/constants.js";

export const dynamic = "force-dynamic";

const green = "#2A7E4F";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  // Check the employee record, not just the session: a session for a deleted employee must still see this page.
  if (await currentEmployee()) redirect("/");
  const { error } = await searchParams;

  async function microsoft() {
    "use server";
    await signIn("microsoft-entra-id", { redirectTo: "/" });
  }

  async function demo(formData: FormData) {
    "use server";
    try {
      await signIn("demo", { email: formData.get("email"), redirectTo: "/" });
    } catch (e) {
      if (e instanceof AuthError) redirect("/login?error=demo");
      throw e;
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "#F2F4F3" }}>
      <div style={{ width: "100%", maxWidth: 420, background: "#fff", border: "1px solid #E1E5E3", borderRadius: 7, overflow: "hidden", boxShadow: "0 12px 40px rgba(31,31,29,.08)" }}>
        <div style={{ background: green, padding: "22px 24px", display: "flex", alignItems: "center", gap: 16 }}>
          <img src="/assets/nesr-logo-white.png" alt="NESR" style={{ height: 34, width: "auto" }} />
          <div style={{ width: 1, height: 28, background: "rgba(255,255,255,.35)" }} />
          <div style={{ color: "#fff", fontSize: 15, fontWeight: "bold" }}>Learning &amp; Development Portal</div>
        </div>
        <div style={{ padding: "26px 24px" }}>
          <div style={{ fontSize: 20, fontWeight: "bold" }}>Sign in</div>
          <div style={{ fontSize: 13, color: "#58595B", marginTop: 4, marginBottom: 20 }}>Use your NESR Microsoft account.</div>
          {error && (
            <div style={{ background: "#F7DEDE", color: "#8A2B2B", fontSize: 12, padding: "9px 12px", borderRadius: 4, marginBottom: 14 }}>
              {error === "demo" ? "That demo user isn't set up. Run the demo seed first." : "Sign-in failed. Try again, or contact IT if it keeps happening."}
            </div>
          )}
          <form action={microsoft}>
            <button type="submit" style={{ width: "100%", padding: "11px 14px", border: 0, borderRadius: 4, background: green, color: "#fff", fontWeight: "bold", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
              <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true"><path fill="#f25022" d="M1 1h9v9H1z"/><path fill="#7fba00" d="M11 1h9v9h-9z"/><path fill="#00a4ef" d="M1 11h9v9H1z"/><path fill="#ffb900" d="M11 11h9v9h-9z"/></svg>
              Sign in with Microsoft
            </button>
          </form>

          {demoLoginEnabled && (
            <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid #E1E5E3" }}>
              <div style={{ fontSize: 11, fontWeight: "bold", letterSpacing: ".8px", textTransform: "uppercase", color: "#8A6100", marginBottom: 8 }}>Demo login — testing only</div>
              <form action={demo} style={{ display: "flex", gap: 8 }}>
                <select name="email" style={{ flex: 1, padding: "8px", border: "1px solid #D1D3D4", borderRadius: 4, background: "#fff" }}>
                  {DEMO_PEOPLE.map(p => <option key={p.email} value={p.email}>{p.name} — {p.title}</option>)}
                </select>
                <button type="submit" style={{ padding: "8px 14px", border: "1px solid #D1D3D4", background: "#fff", borderRadius: 4, fontWeight: "bold", cursor: "pointer" }}>Enter</button>
              </form>
              <div style={{ fontSize: 11, color: "#8A8F8C", marginTop: 8 }}>Turn off by removing LD_DEMO_LOGIN before go-live.</div>
            </div>
          )}

          <div style={{ fontSize: 11, color: "#58595B", marginTop: 22 }}>
            Need help? Contact the L&amp;D team at <a href="mailto:learning@nesr.com">learning@nesr.com</a>
          </div>
        </div>
      </div>
    </div>
  );
}
