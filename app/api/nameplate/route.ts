import { NextResponse } from "next/server";
import { currentEmployee } from "@/auth";
import { prisma } from "@/lib/prisma";
import { nameplatePdf, type Nameplate, type Brand } from "@/lib/nameplate";
import { audienceIds } from "@/lib/audience.js";
import { dateRange } from "@/lib/training-format.js";

export const runtime = "nodejs";

/**
 * Admin download from the Name Tags page.
 * Body: {
 *   trainingId,
 *   who: "enrolled" | "participants" | "selected" | "typed",
 *   ids?: string[]          (who = "selected": employee ids, e.g. some NESR people and some CPVEN externals)
 *   names?: string          (who = "typed": one name per line)
 *   instructor?: string     (also print a nameplate for this instructor)
 *   instructorRole?: string (printed under the instructor's name; default "Instructor")
 *   brand?: "nesr" | "cpven",
 *   date?: string
 * }
 */
export async function POST(req: Request) {
  const me = await currentEmployee();
  if (!me?.isAdmin) return NextResponse.json({ error: "Only the L&D team can generate nameplates." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const t = await prisma.training.findUnique({ where: { id: String(body.trainingId || "") } });
  if (!t) return NextResponse.json({ error: "Choose a training." }, { status: 400 });

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const date = String(body.date || "").trim().slice(0, 80) || dateRange(iso(t.startDate), iso(t.endDate));
  const brand: Brand = body.brand === "cpven" ? "cpven" : "nesr";
  const who = String(body.who || "");

  let names: string[] = [];
  if (who === "typed") {
    names = String(body.names || "").split(/\r?\n/).map(s => s.trim().slice(0, 120)).filter(Boolean).slice(0, 200);
  } else if (who === "selected") {
    const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).slice(0, 500);
    const people = await prisma.employee.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" } });
    names = people.map(p => p.name);
  } else if (who === "participants" || who === "enrolled") {
    const [requests, attendance] = await Promise.all([
      prisma.trainingRequest.findMany({ where: { trainingId: t.id }, select: { employeeId: true, state: true } }),
      prisma.attendance.findMany({ where: { trainingId: t.id } })
    ]);
    const ids = audienceIds(
      who,
      t.id,
      requests.map(r => ({ who: r.employeeId, tid: t.id, state: r.state })),
      Object.fromEntries(attendance.map(a => [`${t.id}:${a.employeeId}`, a.attended]))
    );
    const people = await prisma.employee.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" } });
    names = people.map(p => p.name);
  }

  const plates: Nameplate[] = names.map(name => ({ name, course: t.title, date }));
  const instructor = String(body.instructor || "").trim().slice(0, 120);
  const instructorRole = String(body.instructorRole ?? "").trim().slice(0, 80) || "Instructor";
  if (instructor) plates.unshift({ name: instructor, course: t.title, date, role: instructorRole });
  if (!plates.length) return NextResponse.json({ error: "No one to print a nameplate for." }, { status: 400 });

  const pdf = await nameplatePdf(plates, brand);
  await prisma.auditLog.create({ data: { actorId: me.id, action: "nameplates", entity: "training", entityId: t.id, details: { count: plates.length, brand } } });

  const file = plates.length === 1 ? `Nameplate - ${plates[0].name}.pdf` : `Nameplates - ${t.code}${brand === "cpven" ? " (CPVEN)" : ""}.pdf`;
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${file.replace(/[^\w .()-]/g, "_")}"`,
      "Cache-Control": "no-store"
    }
  });
}
