import "server-only";
import crypto from "node:crypto";
import { safeEqual } from "@/lib/safe-equal";

// QR codes carry a short signature so people can't make check-in links for other days or trainings.
// Signed with the app's existing auth secret; nothing is stored.

function secret() {
  const s = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET / NEXTAUTH_SECRET is not set");
  return s;
}

export function qrSignature(kind: "checkin" | "survey", trainingId: string, day = "") {
  return crypto.createHmac("sha256", secret()).update(`${kind}:${trainingId}:${day}`).digest("base64url").slice(0, 16);
}

export function qrValid(kind: "checkin" | "survey", trainingId: string, day: string, sig: string) {
  return !!sig && safeEqual(qrSignature(kind, trainingId, day), sig);
}
