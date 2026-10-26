import { NextResponse } from "next/server";
import { currentEmployee } from "@/auth";
import { prisma } from "@/lib/prisma";
import { participantListPdf, type ListRow } from "@/lib/participant-list";
import { dateRange } from "@/lib/training-format.js";

export const runtime = "nodejs";

const STATUS: Record<string, string> = {
  pending: "Awaiting manager", enrolled: "Enrolled", waitlist: "Waitlisted", completed: "Completed", rejected: "Declined"
};
const ORDER = ["enrolled", "completed", "waitlist", "pending", "rejected"];

/** GET /api/export/training?id=<trainingId> — participant list PDF (L&D only). */
export async function GET(req: Request) {
  const me = await currentEmployee();
  if (!me?.isAdmin) return NextResponse.json({ error: "Only the L&D team can export participant lists." }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id") || "";
  const t = await prisma.training.findUnique({ where: { id } });
  if (!t) return NextResponse.json({ error: "Training not found." }, { status: 404 });

  const [requests, attendance] = await Promise.all([
    prisma.trainingRequest.findMany({ where: { trainingId: t.id }, include: { employee: true } }),
    prisma.attendance.findMany({ where: { trainingId: t.id } })
  ]);
  const att = new Map(attendance.map(a => [a.employeeId, a.attended]));
  const rows: ListRow[] = requests
    .sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.employee.name.localeCompare(b.employee.name))
    .map(r => ({
      name: r.employee.name, nesrId: r.employee.nesrId || "", department: r.employee.department || "", email: r.employee.email,
      status: STATUS[r.state] || r.state,
      attendance: att.get(r.employeeId) === true ? "Attended" : att.get(r.employeeId) === false ? "No show" : ""
    }));

  const count = (s: string) => requests.filter(r => r.state === s).length;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const pdf = await participantListPdf({
    code: t.code, title: t.title, dates: dateRange(iso(t.startDate), iso(t.endDate)), location: t.location,
    instructor: t.instructor || "", seats: `${t.enrolled} of ${t.seats} seats taken`,
    summary: `${count("enrolled") + count("completed")} enrolled · ${count("waitlist")} waitlisted · ${count("pending")} awaiting manager · ${count("rejected")} declined`
  }, rows);

  await prisma.auditLog.create({ data: { actorId: me.id, action: "export", entity: "training", entityId: t.id, details: { rows: rows.length } } });
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Participants - ${t.code.replace(/[^\w .-]/g, "_")}.pdf"`,
      "Cache-Control": "no-store"
    }
  });
}
