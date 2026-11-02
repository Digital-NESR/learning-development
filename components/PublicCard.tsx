import type { ReactNode } from "react";

// Simple branded card for the phone pages people reach by scanning a QR code (check-in, survey).
export default function PublicCard({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 16px", background: "#F2F4F3" }}>
      <div style={{ width: "100%", maxWidth: wide ? 720 : 440, background: "#fff", border: "1px solid #E1E5E3", borderRadius: 7, overflow: "hidden", boxShadow: "0 12px 40px rgba(31,31,29,.08)" }}>
        <div style={{ background: "#2A7E4F", padding: "18px 22px", display: "flex", alignItems: "center", gap: 14 }}>
          <img src="/assets/nesr-logo-white.png" alt="NESR" style={{ height: 28, width: "auto" }} />
          <div style={{ width: 1, height: 24, background: "rgba(255,255,255,.35)" }} />
          <div style={{ color: "#fff", fontSize: 14, fontWeight: "bold" }}>Training Portal</div>
        </div>
        <div style={{ padding: "22px 22px 26px" }}>{children}</div>
      </div>
    </div>
  );
}
