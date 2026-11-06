import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { currentEmployee } from "@/auth";
import { prisma } from "@/lib/prisma";
import { statusLabel } from "@/lib/constants.js";

export const runtime = "nodejs";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * POST /api/export/calendar — the training calendar as Excel, with the same columns as the calendar table.
 * Body: { ids?: string[] } to export only the trainings shown with the current filters. Any signed-in employee.
 */
export async function POST(req: Request) {
  const me = await currentEmployee();
  if (!me) return NextResponse.json({ error: "Your session has expired. Sign in again." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 2000) : null;
  const trainings = await prisma.training.findMany({
    where: { isActive: true, ...(ids ? { id: { in: ids } } : {}) },
    orderBy: { startDate: "asc" }
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "NESR Training Portal";
  const ws = wb.addWorksheet("Training Calendar");
  ws.columns = [
    { header: "Training Category", key: "category", width: 24 },
    { header: "Training Code", key: "code", width: 13 },
    { header: "Training Name", key: "title", width: 40 },
    { header: "Training Status", key: "status", width: 18 },
    { header: "Quarter", key: "quarter", width: 9 },
    { header: "Month", key: "month", width: 9 },
    { header: "Start Date", key: "start", width: 13, style: { numFmt: "dd/mm/yyyy" } },
    { header: "End Date", key: "end", width: 13, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Location", key: "location", width: 20 },
    { header: "Type of Training", key: "type", width: 16 },
    { header: "Target Audience", key: "audience", width: 24 },
    { header: "Training Provider", key: "provider", width: 22 },
    { header: "Instructor", key: "instructor", width: 22 },
    { header: "Instructor Location", key: "instructorLocation", width: 18 }
  ];
  for (const t of trainings) {
    ws.addRow({
      category: t.category, code: t.code, title: t.title, status: statusLabel(t.status),
      quarter: "Q" + (Math.floor(t.startDate.getUTCMonth() / 3) + 1), month: MONTHS[t.startDate.getUTCMonth()],
      start: day(t.startDate), end: day(t.endDate), location: t.location, type: t.type,
      audience: t.targetAudience || "", provider: t.provider || "", instructor: t.instructor || "", instructorLocation: t.instructorLocation || ""
    });
  }
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2A7E4F" } };
  head.alignment = { vertical: "middle", wrapText: true };
  head.height = 30;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };

  const buf = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(Buffer.from(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Training Calendar ${stamp}.xlsx"`,
      "Cache-Control": "no-store"
    }
  });
}
