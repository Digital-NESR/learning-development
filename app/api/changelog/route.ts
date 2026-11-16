import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { currentEmployee } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadChangeLog } from "@/lib/changelog";

export const runtime = "nodejs";

const stamp = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";

/**
 * Session change log (L&D only).
 * GET ?id=…            one session's log as JSON (session page)
 * GET ?format=xlsx     every session's log as Excel (one row per changed field); add &id=… for one session
 */
export async function GET(req: Request) {
  const me = await currentEmployee();
  if (!me?.isAdmin) return NextResponse.json({ error: "Only the L&D team can see the change log." }, { status: 403 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || undefined;

  if (url.searchParams.get("format") !== "xlsx") {
    if (!id) return NextResponse.json({ error: "Missing session." }, { status: 400 });
    const log = await loadChangeLog(id, 300);
    return NextResponse.json({ entries: log.map(e => ({ ...e, at: e.at.toISOString() })) });
  }

  const log = await loadChangeLog(id, 20000);
  const trainings = await prisma.training.findMany({ select: { id: true, code: true, title: true } });
  const tOf = new Map(trainings.map(t => [t.id, t]));
  const wb = new ExcelJS.Workbook();
  wb.creator = "NESR Training Portal";
  const ws = wb.addWorksheet("Change Log");
  ws.columns = [
    { header: "Date & Time (UTC)", key: "at", width: 20 },
    { header: "Changed By", key: "who", width: 24 },
    { header: "Training Code", key: "code", width: 13 },
    { header: "Training Name", key: "title", width: 36 },
    { header: "Change", key: "what", width: 46 },
    { header: "Field", key: "field", width: 20 },
    { header: "Old Value", key: "from", width: 28 },
    { header: "New Value", key: "to", width: 28 },
    { header: "Reason", key: "reason", width: 40 }
  ];
  for (const e of log) {
    const t = tOf.get(e.trainingId);
    const base = { at: stamp(e.at), who: e.who, code: t?.code || "", title: t?.title || "(removed)", what: e.what, reason: e.reason };
    if (!e.changes.length) ws.addRow(base);
    for (const c of e.changes) ws.addRow({ ...base, field: c.field, from: c.from, to: c.to });
  }
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2A7E4F" } };
  head.alignment = { vertical: "middle", wrapText: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
  ws.getColumn("from").alignment = { wrapText: true, vertical: "top" };
  ws.getColumn("to").alignment = { wrapText: true, vertical: "top" };

  await prisma.auditLog.create({ data: { actorId: me.id, action: "export_changelog", entity: "report", entityId: id || "all", details: { rows: log.length } } });
  const buf = await wb.xlsx.writeBuffer();
  const code = id ? tOf.get(id)?.code || "Session" : "All Sessions";
  return new NextResponse(Buffer.from(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Change Log ${code} ${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "Cache-Control": "no-store"
    }
  });
}
