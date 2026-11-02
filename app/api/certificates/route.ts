import { NextResponse } from "next/server";
import { currentEmployee } from "@/auth";
import { prisma } from "@/lib/prisma";
import { certificatePdf, certificatePptx, type CertBrand } from "@/lib/certificate";
import { audienceIds } from "@/lib/audience.js";
import { longDateRange } from "@/lib/training-days.js";

export const runtime = "nodejs";

/**
 * Certificates of completion (L&D only).
 * Body: {
 *   trainingId,
 *   who: "participants" | "enrolled" | "selected" | "typed",
 *   ids?: string[], names?: string,         (as for nameplates)
 *   brand?: "nesr" | "cpven",
 *   format?: "pdf" | "pptx",
 *   instructorName?, instructorTitle?,
 *   signature?: "data:image/png;base64,…"   (optional instructor signature)
 * }
 */
export async function POST(req: Request) {
  const me = await currentEmployee();
  if (!me?.isAdmin) return NextResponse.json({ error: "Only the L&D team can generate certificates." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const t = await prisma.training.findUnique({ where: { id: String(body.trainingId || "") } });
  if (!t) return NextResponse.json({ error: "Choose a training." }, { status: 400 });

  const brand: CertBrand = body.brand === "cpven" ? "cpven" : "nesr";
  const format = body.format === "pptx" ? "pptx" : "pdf";
  const who = String(body.who || "");

  let names: string[] = [];
  if (who === "typed") {
    names = String(body.names || "").split(/\r?\n/).map(s => s.trim().slice(0, 120)).filter(Boolean).slice(0, 300);
  } else if (who === "selected") {
    const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).slice(0, 500);
    names = (await prisma.employee.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" } })).map(p => p.name);
  } else if (who === "participants" || who === "enrolled") {
    const [requests, attendance] = await Promise.all([
      prisma.trainingRequest.findMany({ where: { trainingId: t.id }, select: { employeeId: true, state: true } }),
      prisma.attendance.findMany({ where: { trainingId: t.id } })
    ]);
    const ids = audienceIds(who, t.id,
      requests.map(r => ({ who: r.employeeId, tid: t.id, state: r.state })),
      Object.fromEntries(attendance.map(a => [`${t.id}:${a.employeeId}`, a.attended])));
    names = (await prisma.employee.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" } })).map(p => p.name);
  }
  if (!names.length) return NextResponse.json({ error: "No one to make a certificate for." }, { status: 400 });

  let signature: { bytes: Uint8Array; type: "png" | "jpg" } | null = null;
  const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.signature || ""));
  if (body.signature && !m) return NextResponse.json({ error: "The signature must be a PNG or JPG image." }, { status: 400 });
  if (m) {
    const bytes = Buffer.from(m[2], "base64");
    if (bytes.length > 2_000_000) return NextResponse.json({ error: "The signature image is too large (2 MB max)." }, { status: 400 });
    signature = { bytes: new Uint8Array(bytes), type: m[1] === "png" ? "png" : "jpg" };
  }

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const input = {
    brand, names,
    course: t.title,
    dates: longDateRange(iso(t.startDate), iso(t.endDate)) + (t.location ? ", " + t.location : ""),
    instructorName: String(body.instructorName ?? t.instructor ?? "").trim().slice(0, 120),
    instructorTitle: String(body.instructorTitle ?? "Instructor").trim().slice(0, 120),
    signature
  };

  let file: Uint8Array;
  try {
    file = format === "pptx" ? await certificatePptx(input) : await certificatePdf(input);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "The certificate templates aren't installed on the server yet. Ask the portal admin to add the templates folder." }, { status: 500 });
    }
    console.error("certificate", e);
    return NextResponse.json({ error: "Couldn't create the certificates. If you added a signature, try a different image." }, { status: 500 });
  }
  await prisma.auditLog.create({ data: { actorId: me.id, action: "certificates", entity: "training", entityId: t.id, details: { count: names.length, brand, format } } });

  const base = names.length === 1 ? `Certificate - ${names[0]}` : `Certificates - ${t.code}${brand === "cpven" ? " (CPVEN)" : ""}`;
  return new NextResponse(Buffer.from(file), {
    headers: {
      "Content-Type": format === "pptx" ? "application/vnd.openxmlformats-officedocument.presentationml.presentation" : "application/pdf",
      "Content-Disposition": `attachment; filename="${base.replace(/[^\w .()-]/g, "_")}.${format}"`,
      "Cache-Control": "no-store"
    }
  });
}
