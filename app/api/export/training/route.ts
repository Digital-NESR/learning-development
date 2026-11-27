import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { currentEmployee } from "@/auth";
import { prisma } from "@/lib/prisma";
import { dateRange } from "@/lib/training-format.js";

export const runtime = "nodejs";

const STATUS: Record<string, string> = {
  pending: "Pending Approval", enrolled: "Approved", waitlist: "Waitlisted", completed: "Completed", rejected: "Rejected"
};
const ORDER = ["enrolled", "completed", "waitlist", "pending", "rejected"];
const GREEN = "FF2A7E4F";
const day = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** GET /api/export/training?id=<trainingId> — a session's participant list as Excel, to review and annotate (L&D only). */
export async function GET(req: Request) {
  const me = await currentEmployee();
  if (!me?.isAdmin) return NextResponse.json({ error: "Only the L&D team can export participant lists." }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id") || "";
  const t = await prisma.training.findUnique({ where: { id } });
  if (!t) return NextResponse.json({ error: "Training not found." }, { status: 404 });

  const [requests, attendance] = await Promise.all([
    prisma.trainingRequest.findMany({ where: { trainingId: t.id }, include: { employee: true, steps: { orderBy: { stepNo: "desc" }, take: 1, include: { approver: true } } } }),
    prisma.attendance.findMany({ where: { trainingId: t.id } })
  ]);
  const rejecters = new Map((await prisma.employee.findMany({
    where: { id: { in: [...new Set(requests.map(r => r.rejectedById).filter((x): x is string => !!x))] } }, select: { id: true, name: true }
  })).map(p => [p.id, p.name]));
  const att = new Map<string, boolean | "partial">(attendance.map(a => [a.employeeId, a.partial ? "partial" : a.attended]));

  const wb = new ExcelJS.Workbook();
  wb.creator = "NESR Training Portal";
  const ws = wb.addWorksheet("Participants", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  const columns = [
    { header: "No.", key: "n", width: 5 },
    { header: "Employee Name", key: "name", width: 28 },
    { header: "NESR ID", key: "nesrId", width: 11 },
    { header: "Department", key: "department", width: 22 },
    { header: "Work Location", key: "loc", width: 18 },
    { header: "Email", key: "email", width: 30 },
    { header: "Registration Status", key: "status", width: 18 },
    { header: "Manager", key: "manager", width: 24 },
    { header: "Manager Decision", key: "decision", width: 16 },
    { header: "Requested On", key: "submitted", width: 13, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Business Justification", key: "justification", width: 40 },
    { header: "Rejected By", key: "rejectedBy", width: 22 },
    { header: "Rejection Justification", key: "rejectReason", width: 40 },
    { header: "Attendance", key: "attendance", width: 16 },
    { header: "Notes", key: "notes", width: 30 }
  ];

  // Title block, then the table from row 5
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const count = (s: string) => requests.filter(r => r.state === s).length;
  ws.mergeCells(1, 1, 1, columns.length);
  ws.getCell(1, 1).value = `${t.code} · ${t.title}`;
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: GREEN } };
  ws.mergeCells(2, 1, 2, columns.length);
  ws.getCell(2, 1).value = `${dateRange(iso(t.startDate), iso(t.endDate))} · ${t.location}${t.instructor ? " · Instructor: " + t.instructor : ""} · ${t.enrolled} of ${t.seats} seats taken`;
  ws.mergeCells(3, 1, 3, columns.length);
  ws.getCell(3, 1).value = `${count("enrolled") + count("completed")} approved · ${count("pending")} pending approval · ${count("waitlist")} waitlisted · ${count("rejected")} rejected`;
  ws.getCell(3, 1).font = { color: { argb: "FF58595B" } };

  columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; if (c.style) ws.getColumn(i + 1).numFmt = c.style.numFmt; });
  const head = ws.getRow(5);
  columns.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  head.height = 30;

  const rows = requests.sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.employee.name.localeCompare(b.employee.name));
  rows.forEach((r, i) => {
    const e = r.employee, form = (r.form || {}) as Record<string, string>, step = r.steps[0];
    const a = att.get(r.employeeId);
    const row = ws.getRow(6 + i);
    const values: Record<string, unknown> = {
      n: i + 1,
      name: e.name + (e.isExternal ? ` (${e.organization || "External"})` : ""),
      nesrId: form.nesrId || e.nesrId || "", department: form.dept || e.department || e.organization || "", loc: form.loc || e.location || "",
      email: e.email.endsWith("@external.invalid") ? "" : e.email,
      status: STATUS[r.state] || r.state,
      manager: step ? step.approver.name : e.isExternal ? "External" : "Added by L&D",
      decision: step ? ({ approved: "Approved", rejected: "Rejected", waiting: "Pending" } as Record<string, string>)[step.status] : "",
      submitted: day(r.submittedAt),
      justification: r.justification || "",
      rejectedBy: r.state === "rejected" ? (r.rejectedById && rejecters.get(r.rejectedById)) || (step?.status === "rejected" ? step.approver.name : "") : "",
      rejectReason: r.state === "rejected" ? r.decisionComment || "" : "",
      attendance: a === true ? "Attended" : a === "partial" ? "Partially attended" : a === false ? "No show" : "",
      notes: ""
    };
    columns.forEach((c, j) => {
      const cell = row.getCell(j + 1);
      cell.value = values[c.key] as ExcelJS.CellValue;
      cell.alignment = { vertical: "top", wrapText: true };
      if (i % 2) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F9F8" } };
    });
  });
  ws.views = [{ state: "frozen", ySplit: 5 }];
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: columns.length } };

  await prisma.auditLog.create({ data: { actorId: me.id, action: "export", entity: "training", entityId: t.id, details: { rows: rows.length } } });
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Participants - ${t.code.replace(/[^\w .-]/g, "_")}.xlsx"`,
      "Cache-Control": "no-store"
    }
  });
}
