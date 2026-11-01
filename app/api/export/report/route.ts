import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { currentEmployee } from "@/auth";
import { prisma } from "@/lib/prisma";
import { statusLabel } from "@/lib/constants.js";

export const runtime = "nodejs";

// Full registration report for L&D (Excel). Sheet 1 keeps the columns of the existing
// "L&D Dashboard data" export, then adds the calendar fields; sheet 2 lists every training.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const REG_STATUS: Record<string, string> = {
  pending: "Pending Approval", enrolled: "Registered", waitlist: "Waitlisted", completed: "Completed", rejected: "Rejected", lnd: "Registered"
};
const APPROVAL: Record<string, string> = { approved: "Approved", rejected: "Rejected", waiting: "Pending" };

const quarter = (d: Date) => "Q" + (Math.floor(d.getUTCMonth() / 3) + 1);
const month = (d: Date) => MONTHS[d.getUTCMonth()];
const day = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2A7E4F" } };
  row.alignment = { vertical: "middle", wrapText: true };
  row.height = 30;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

/** GET /api/export/report — all trainings and registrations as an Excel workbook (L&D only). */
export async function GET() {
  const me = await currentEmployee();
  if (!me?.isAdmin) return NextResponse.json({ error: "Only the L&D team can export reports." }, { status: 403 });

  const [trainings, requests, attendance] = await Promise.all([
    prisma.training.findMany({ where: { isActive: true }, orderBy: { startDate: "asc" } }),
    prisma.trainingRequest.findMany({
      where: { training: { isActive: true } },
      include: {
        employee: { include: { manager: true } },
        training: true,
        steps: { orderBy: { stepNo: "desc" }, take: 1, include: { approver: true } }
      },
      orderBy: { submittedAt: "asc" }
    }),
    prisma.attendance.findMany()
  ]);
  const att = new Map(attendance.map(a => [`${a.trainingId}:${a.employeeId}`, a.attended]));

  const wb = new ExcelJS.Workbook();
  wb.creator = "NESR Training Portal";
  wb.created = new Date();

  // ---- Sheet 1: one row per registration ----
  const ws = wb.addWorksheet("Registrations");
  ws.columns = [
    { header: "NESR ID", key: "nesrId", width: 11 },
    { header: "Requestor", key: "requestor", width: 28 },
    { header: "Position", key: "position", width: 24 },
    { header: "Nationality", key: "nationality", width: 16 },
    { header: "Country", key: "country", width: 16 },
    { header: "Department", key: "department", width: 24 },
    { header: "Request Date", key: "requestDate", width: 20, style: { numFmt: "dd/mm/yyyy hh:mm" } },
    { header: "Type of Training", key: "type", width: 16 },
    { header: "Training Category", key: "category", width: 24 },
    { header: "Training", key: "training", width: 38 },
    { header: "Training Location", key: "location", width: 20 },
    { header: "Approval Status", key: "approval", width: 15 },
    { header: "Manager", key: "manager", width: 24 },
    { header: "Approved By", key: "approvedBy", width: 24 },
    { header: "Comments", key: "comments", width: 36 },
    { header: "Approval Date", key: "approvalDate", width: 20, style: { numFmt: "dd/mm/yyyy hh:mm" } },
    // Calendar fields requested by L&D
    { header: "Training Code", key: "code", width: 13 },
    { header: "Training Status", key: "status", width: 18 },
    { header: "Quarter", key: "quarter", width: 9 },
    { header: "Month", key: "month", width: 9 },
    { header: "Training Start Date", key: "start", width: 15, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Training End Date", key: "end", width: 15, style: { numFmt: "dd/mm/yyyy" } },
    // Portal fields
    { header: "Registration Status", key: "regStatus", width: 18 },
    { header: "Attendance", key: "attendance", width: 12 },
    { header: "Organization", key: "organization", width: 14 },
    { header: "Email", key: "email", width: 30 }
  ];
  for (const r of requests) {
    const e = r.employee, t = r.training, last = r.steps[0];
    const form = (r.form || {}) as Record<string, string>;
    const decided = last && last.status !== "waiting";
    const a = att.get(`${t.id}:${e.id}`);
    ws.addRow({
      nesrId: e.nesrId || form.nesrId || "",
      requestor: e.name,
      position: e.title || "",
      nationality: form.nat || "",
      country: e.country || "",
      department: e.department || form.dept || "",
      requestDate: r.submittedAt,
      type: t.type,
      category: t.category,
      training: t.title,
      location: t.location,
      approval: last ? APPROVAL[last.status] : e.isExternal ? "External" : "Added by L&D",
      manager: last?.approver.name || e.manager?.name || "",
      approvedBy: decided ? last.approver.name : "",
      comments: r.decisionComment || last?.comment || "",
      approvalDate: decided && last.decidedAt ? last.decidedAt : null,
      code: t.code,
      status: statusLabel(t.status),
      quarter: quarter(t.startDate),
      month: month(t.startDate),
      start: day(t.startDate),
      end: day(t.endDate),
      regStatus: REG_STATUS[r.state] || r.state,
      attendance: a === true ? "Attended" : a === false ? "No show" : "",
      organization: e.isExternal ? e.organization || "External" : "NESR",
      email: e.isExternal && e.email.endsWith("@external.invalid") ? "" : e.email
    });
  }
  styleHeader(ws);

  // ---- Sheet 2: one row per training ----
  const ts = wb.addWorksheet("Trainings");
  ts.columns = [
    { header: "Training Category", key: "category", width: 24 },
    { header: "Training Code", key: "code", width: 13 },
    { header: "Training Name", key: "title", width: 38 },
    { header: "Training Status", key: "status", width: 18 },
    { header: "Quarter", key: "quarter", width: 9 },
    { header: "Month", key: "month", width: 9 },
    { header: "Training Start Date", key: "start", width: 15, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Training End Date", key: "end", width: 15, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Training Location", key: "location", width: 20 },
    { header: "Type of Training", key: "type", width: 16 },
    { header: "Target Audience", key: "audience", width: 22 },
    { header: "Training Provider", key: "provider", width: 20 },
    { header: "Instructor", key: "instructor", width: 20 },
    { header: "Instructor Location", key: "instructorLocation", width: 18 },
    { header: "Seats", key: "seats", width: 8 },
    { header: "Registered", key: "registered", width: 11 },
    { header: "Pending Approval", key: "pending", width: 11 },
    { header: "Waitlisted", key: "waitlist", width: 11 },
    { header: "Rejected", key: "rejected", width: 10 },
    { header: "Completed", key: "completed", width: 11 }
  ];
  for (const t of trainings) {
    const reqs = requests.filter(r => r.trainingId === t.id);
    const n = (s: string) => reqs.filter(r => r.state === s).length;
    ts.addRow({
      category: t.category, code: t.code, title: t.title, status: statusLabel(t.status),
      quarter: quarter(t.startDate), month: month(t.startDate), start: day(t.startDate), end: day(t.endDate),
      location: t.location, type: t.type, audience: t.targetAudience || "", provider: t.provider || "",
      instructor: t.instructor || "", instructorLocation: t.instructorLocation || "", seats: t.seats,
      registered: n("enrolled") + n("completed"), pending: n("pending"), waitlist: n("waitlist"), rejected: n("rejected"), completed: n("completed")
    });
  }
  styleHeader(ts);

  const buf = await wb.xlsx.writeBuffer();
  await prisma.auditLog.create({ data: { actorId: me.id, action: "export_report", entity: "report", entityId: "all", details: { rows: requests.length } } });
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(Buffer.from(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Training Portal report ${stamp}.xlsx"`,
      "Cache-Control": "no-store"
    }
  });
}
