import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { currentEmployee } from "@/auth";
import { prisma } from "@/lib/prisma";
import { SURVEY_QUESTIONS, SURVEY_COMMENTS } from "@/lib/survey.js";

export const runtime = "nodejs";

const GREEN = "FF2A7E4F";

/** GET /api/export/survey?id=<trainingId> (one training) or without id (all trainings) — feedback results (L&D only). */
export async function GET(req: Request) {
  const me = await currentEmployee();
  if (!me?.isAdmin) return NextResponse.json({ error: "Only the L&D team can export survey results." }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id") || "";
  const t = id ? await prisma.training.findUnique({ where: { id } }) : null;
  if (id && !t) return NextResponse.json({ error: "Training not found." }, { status: 404 });

  const responses = await prisma.surveyResponse.findMany({
    where: id ? { trainingId: id } : {},
    include: { employee: true, training: true },
    orderBy: [{ training: { startDate: "asc" } }, { createdAt: "asc" }]
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "NESR Training Portal";

  // Sheet 1: average per question (per training)
  const sum = wb.addWorksheet("Summary");
  const trainings = [...new Map(responses.map(r => [r.trainingId, r.training])).values()];
  sum.columns = [
    { header: "Section", key: "section", width: 28 }, { header: "Statement", key: "text", width: 62 },
    ...trainings.map(tr => ({ header: `${tr.code} (${responses.filter(r => r.trainingId === tr.id).length})`, key: tr.id, width: 14, style: { numFmt: "0.00" } }))
  ];
  for (const q of SURVEY_QUESTIONS) {
    const row: Record<string, string | number | null> = { section: q.section, text: q.text };
    for (const tr of trainings) {
      const vals = responses.filter(r => r.trainingId === tr.id).map(r => (r.ratings as Record<string, number | null>)[q.id]).filter((v): v is number => typeof v === "number");
      row[tr.id] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }
    sum.addRow(row);
  }
  const overall: Record<string, string | number | null> = { section: "Overall", text: "Average of all statements" };
  for (const tr of trainings) {
    const vals = responses.filter(r => r.trainingId === tr.id).flatMap(r => Object.values(r.ratings as Record<string, number | null>)).filter((v): v is number => typeof v === "number");
    overall[tr.id] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  sum.addRow(overall).font = { bold: true };

  // Sheet 2: every response
  const all = wb.addWorksheet("Responses");
  all.columns = [
    { header: "Training Code", key: "code", width: 13 }, { header: "Training", key: "title", width: 34 },
    { header: "Employee ID", key: "nesrId", width: 12 }, { header: "Employee Name", key: "name", width: 28 },
    { header: "Submitted", key: "at", width: 18, style: { numFmt: "dd/mm/yyyy hh:mm" } },
    ...SURVEY_QUESTIONS.map(q => ({ header: q.text, key: q.id, width: 16 })),
    { header: "Average", key: "avg", width: 10, style: { numFmt: "0.00" } },
    ...SURVEY_COMMENTS.map(c => ({ header: c.text, key: c.id, width: 46 }))
  ];
  for (const r of responses) {
    const ratings = r.ratings as Record<string, number | null>;
    const vals = Object.values(ratings).filter((v): v is number => typeof v === "number");
    all.addRow({
      code: r.training.code, title: r.training.title, nesrId: r.employee.nesrId || "", name: r.employee.name, at: r.updatedAt,
      ...Object.fromEntries(SURVEY_QUESTIONS.map(q => [q.id, ratings[q.id] ?? "N/A"])),
      avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
      likedBest: r.likedBest || "", actionPlan: r.actionPlan || ""
    });
  }
  all.getColumn("likedBest").alignment = { wrapText: true, vertical: "top" };
  all.getColumn("actionPlan").alignment = { wrapText: true, vertical: "top" };

  for (const ws of [sum, all]) {
    const row = ws.getRow(1);
    row.font = { bold: true, color: { argb: "FFFFFFFF" } };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    row.alignment = { vertical: "middle", wrapText: true };
    row.height = ws === all ? 64 : 30;
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  all.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: all.columnCount } };

  await prisma.auditLog.create({ data: { actorId: me.id, action: "export_survey", entity: "training", entityId: id || "all", details: { rows: responses.length } } });
  const name = t ? `Survey results - ${t.code}` : `Survey results ${new Date().toISOString().slice(0, 10)}`;
  return new NextResponse(Buffer.from(await wb.xlsx.writeBuffer()), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\w .()-]/g, "_")}.xlsx"`,
      "Cache-Control": "no-store"
    }
  });
}
