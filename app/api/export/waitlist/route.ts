import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import type { RequestState } from "@prisma/client";
import { currentEmployee } from "@/auth";
import { prisma } from "@/lib/prisma";
import { statusLabel } from "@/lib/constants.js";
import { CANCELLED_KEEP, waitlistKind, waitlistReason } from "@/lib/waitlist.js";

export const runtime = "nodejs";

const STATE: Record<string, string> = { pending: "Pending Approval", enrolled: "Approved", waitlist: "Waitlisted" };
const day = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** GET /api/export/waitlist?kind=all|waitlist|cancelled — the Waitlist Queue as Excel (L&D only). */
export async function GET(req: Request) {
  const me = await currentEmployee();
  if (!me?.isAdmin) return NextResponse.json({ error: "Only the L&D team can export the waitlist." }, { status: 403 });
  const want = new URL(req.url).searchParams.get("kind") || "all";

  const requests = await prisma.trainingRequest.findMany({
    where: {
      training: { isActive: true },
      OR: [{ state: "waitlist" }, { state: { in: CANCELLED_KEEP as RequestState[] }, training: { status: "cancelled" } }]
    },
    include: { employee: true, training: true, steps: { orderBy: { stepNo: "desc" }, take: 1, include: { approver: true } } },
    orderBy: [{ training: { startDate: "asc" } }, { submittedAt: "asc" }]
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "NESR Training Portal";
  const ws = wb.addWorksheet("Waitlist");
  ws.columns = [
    { header: "Employee Name", key: "name", width: 26 },
    { header: "NESR ID", key: "nesrId", width: 11 },
    { header: "Email", key: "email", width: 30 },
    { header: "Department", key: "dept", width: 20 },
    { header: "Work Location", key: "loc", width: 18 },
    { header: "Training Code", key: "code", width: 13 },
    { header: "Training Name", key: "title", width: 38 },
    { header: "Start Date", key: "start", width: 12, style: { numFmt: "dd/mm/yyyy" } },
    { header: "End Date", key: "end", width: 12, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Training Location", key: "location", width: 18 },
    { header: "Training Status", key: "tStatus", width: 18 },
    { header: "Request Status", key: "rStatus", width: 17 },
    { header: "Reason", key: "reason", width: 28 },
    { header: "Approved By", key: "approver", width: 24 },
    { header: "Approved On", key: "approvedOn", width: 12, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Requested On", key: "submitted", width: 12, style: { numFmt: "dd/mm/yyyy" } }
  ];
  let n = 0;
  for (const r of requests) {
    const kind = waitlistKind(r.state, r.training.status);
    if (!kind || (want !== "all" && want !== kind)) continue;
    const form = (r.form || {}) as Record<string, string>;
    const step = r.steps[0];
    ws.addRow({
      name: r.employee.name, nesrId: form.nesrId || r.employee.nesrId || "",
      email: r.employee.email.endsWith("@external.invalid") ? "" : r.employee.email,
      dept: form.dept || r.employee.department || r.employee.organization || "", loc: form.loc || r.employee.location || "",
      code: r.training.code, title: r.training.title, start: day(r.training.startDate), end: day(r.training.endDate), location: r.training.location,
      tStatus: statusLabel(r.training.status), rStatus: STATE[r.state] || r.state,
      reason: waitlistReason(kind, r.training),
      approver: step ? step.approver.name : r.employee.isExternal ? "External" : "Added by L&D",
      approvedOn: step?.status === "approved" && step.decidedAt ? day(step.decidedAt) : null,
      submitted: day(r.submittedAt)
    });
    n++;
  }
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2A7E4F" } };
  head.alignment = { vertical: "middle", wrapText: true };
  head.height = 30;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };

  await prisma.auditLog.create({ data: { actorId: me.id, action: "export", entity: "waitlist", entityId: want, details: { rows: n } } });
  const buf = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  const label = want === "cancelled" ? "Cancelled Sessions" : want === "waitlist" ? "Waitlist" : "Waitlist and Cancelled Sessions";
  return new NextResponse(Buffer.from(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${label} ${stamp}.xlsx"`,
      "Cache-Control": "no-store"
    }
  });
}
