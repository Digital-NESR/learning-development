import { NextResponse } from "next/server";
import { currentEmployee } from "@/auth";
import { prisma } from "@/lib/prisma";
import { attendanceSheetDocx, SHEET_TEMPLATES, type SheetTemplate } from "@/lib/attendance-sheet";

export const runtime = "nodejs";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** GET /api/attendance-sheet?id=<training>&template=nesr|cpven|strategic|synapsco — printable sheet (Word), L&D only. */
export async function GET(req: Request) {
  const me = await currentEmployee();
  if (!me?.isAdmin) return NextResponse.json({ error: "Only the L&D team can print attendance sheets." }, { status: 403 });
  const url = new URL(req.url);
  const t = await prisma.training.findUnique({ where: { id: url.searchParams.get("id") || "" } });
  if (!t) return NextResponse.json({ error: "Choose a training." }, { status: 400 });
  const template = (SHEET_TEMPLATES.find(x => x.value === url.searchParams.get("template"))?.value || "nesr") as SheetTemplate;

  const requests = await prisma.trainingRequest.findMany({
    where: { trainingId: t.id, state: { in: ["enrolled", "completed"] } },
    include: { employee: true }
  });
  const people = requests.map(r => {
    const form = (r.form || {}) as Record<string, string>;
    const e = r.employee;
    return {
      id: e.isExternal ? "" : form.nesrId || e.nesrId || "",
      name: e.name,
      location: e.isExternal ? e.organization || "External" : form.loc || e.location || ""
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  let file: Uint8Array;
  try {
    file = await attendanceSheetDocx({
      template, title: t.title, start: iso(t.startDate), end: iso(t.endDate), location: t.location, instructor: t.instructor || "", people
    });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return NextResponse.json({ error: "The attendance sheet templates aren't installed on the server yet." }, { status: 500 });
    console.error("attendance sheet", e);
    return NextResponse.json({ error: "Couldn't create the attendance sheet. Try again." }, { status: 500 });
  }
  await prisma.auditLog.create({ data: { actorId: me.id, action: "attendance_sheet", entity: "training", entityId: t.id, details: { template, people: people.length } } });
  const label = SHEET_TEMPLATES.find(x => x.value === template)!.label;
  return new NextResponse(Buffer.from(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${`Attendance Sheet - ${t.code} (${label})`.replace(/[^\w .()-]/g, "_")}.docx"`,
      "Cache-Control": "no-store"
    }
  });
}
