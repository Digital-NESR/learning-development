import { NextResponse } from "next/server";
import { currentEmployee } from "@/auth";
import { prisma } from "@/lib/prisma";
import { nameplatePdf, type Nameplate } from "@/lib/nameplate";
import { audienceIds } from "@/lib/audience.js";
import { dateRange } from "@/lib/training-format.js";

export const runtime = "nodejs";

/**
 * Admin download from the Notifications page.
 * Body: { trainingId, who: "participants" | "enrolled" | "custom" | <employeeId>, customName?, date? }
 */
export async function POST(req: Request) {
  const me = await currentEmployee();
  if (!me?.isAdmin) return NextResponse.json({ error: "Only the L&D team can generate nameplates." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const t = await prisma.training.findUnique({ where: { id: String(body.trainingId || "") } });
  if (!t) return NextResponse.json({ error: "Choose a training." }, { status: 400 });

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const date = String(body.date || "").trim().slice(0, 80) || dateRange(iso(t.startDate), iso(t.endDate));
  const who = String(body.who || "");

  let names: string[] = [];
  if (who === "custom") {
    names = [String(body.customName || "").trim().slice(0, 120)].filter(Boolean);
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
  } else if (who) {
    const p = await prisma.employee.findUnique({ where: { id: who } });
    if (p) names = [p.name];
  }
  if (!names.length) return NextResponse.json({ error: "No one to print a nameplate for." }, { status: 400 });

  const plates: Nameplate[] = names.map(name => ({ name, course: t.title, date }));
  const pdf = await nameplatePdf(plates);
  await prisma.auditLog.create({ data: { actorId: me.id, action: "nameplates", entity: "training", entityId: t.id, details: { count: plates.length } } });

  const file = names.length === 1 ? `Nameplate - ${names[0]}.pdf` : `Nameplates - ${t.code}.pdf`;
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${file.replace(/[^\w .-]/g, "_")}"`,
      "Cache-Control": "no-store"
    }
  });
}
