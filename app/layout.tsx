import type { Metadata } from "next";
import "./design.css";
import "./hover.css";

export const metadata: Metadata = {
  title: "NESR Training Portal",
  description: "Browse the training calendar, request sessions and track approvals."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
