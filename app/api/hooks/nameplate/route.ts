import { NextResponse } from "next/server";
import { nameplatePdf, type Nameplate } from "@/lib/nameplate";
import { safeEqual } from "@/lib/site-gate";

export const runtime = "nodejs";

/**
 * Nameplate PDF for automation (e.g. an n8n HTTP Request node).
 * Header: x-api-key: <LD_NAMEPLATE_API_KEY>
 * Body:   { "name": "...", "course": "...", "date": "..." }
 *     or  { "plates": [{ "name", "course", "date" }, ...] }   (max 200)
 * Returns application/pdf.
 */
export async function POST(req: Request) {
  const key = process.env.LD_NAMEPLATE_API_KEY || "";
  const sent = req.headers.get("x-api-key") || "";
  if (!key || !safeEqual(sent, key)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const raw: unknown[] = Array.isArray(body?.plates) ? body.plates : body ? [body] : [];
  const plates: Nameplate[] = raw.slice(0, 200).map(p => {
    const o = (p || {}) as Record<string, unknown>;
    return {
      name: String(o.name ?? "").trim().slice(0, 120),
      course: String(o.course ?? "").trim().slice(0, 200),
      date: String(o.date ?? "").trim().slice(0, 80)
    };
  }).filter(p => p.name);
  if (!plates.length) return NextResponse.json({ error: "Send at least one nameplate with a name." }, { status: 400 });

  const pdf = await nameplatePdf(plates);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="nameplates.pdf"`,
      "Cache-Control": "no-store"
    }
  });
}
