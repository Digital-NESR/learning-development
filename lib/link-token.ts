import "server-only";
import crypto from "node:crypto";
import { safeEqual } from "@/lib/safe-equal";

// Survey links carry a short signature so people can't make links for other trainings.
// Signed with the app's existing auth secret; nothing is stored.

function secret() {
  const s = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET / NEXTAUTH_SECRET is not set");
  return s;
}

export function linkSignature(kind: "survey", trainingId: string) {
  return crypto.createHmac("sha256", secret()).update(`${kind}:${trainingId}:`).digest("base64url").slice(0, 16);
}

export function linkValid(kind: "survey", trainingId: string, sig: string) {
  return !!sig && safeEqual(linkSignature(kind, trainingId), sig);
}
