import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";
import { currentEmployee } from "@/auth";
import { prisma } from "@/lib/prisma";
import { trainingDays, longDate, longDateRange } from "@/lib/training-days.js";

export const runtime = "nodejs";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const quarterOf = (d: Date) => "Q" + (Math.floor(d.getUTCMonth() / 3) + 1);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const GREEN = "FF2A7E4F", PALE = "FFE8F2EC";
const thin = { style: "thin" as const, color: { argb: "FFBFC5C2" } };
const box = { top: thin, left: thin, bottom: thin, right: thin };

/**
 * GET /api/export/attendance?id=<trainingId>  — one training, in L&D's "Training Attendance Sheet" layout
 * GET /api/export/attendance?quarter=Q4&type=HSE&year=2026 — consolidated attendance across trainings
 */
export async function GET(req: Request) {
  const me = await currentEmployee();
  if (!me?.isAdmin) return NextResponse.json({ error: "Only the L&D team can export attendance." }, { status: 403 });
  const q = new URL(req.url).searchParams;
  return q.get("id") ? oneTraining(q.get("id")!, me.id) : consolidated(q, me.id);
}

async function loadAttendance(where: Prisma.TrainingWhereInput) {
  const trainings = await prisma.training.findMany({ where, orderBy: { startDate: "asc" } });
  const ids = trainings.map(t => t.id);
  const [requests, days, overall] = await Promise.all([
    prisma.trainingRequest.findMany({ where: { trainingId: { in: ids }, state: { in: ["enrolled", "completed"] } }, include: { employee: true } }),
    prisma.attendanceDay.findMany({ where: { trainingId: { in: ids } } }),
    prisma.attendance.findMany({ where: { trainingId: { in: ids } } })
  ]);
  const dayMap = new Map(days.map(d => [`${d.trainingId}:${d.employeeId}:${iso(d.day)}`, d.present]));
  const overallMap = new Map(overall.map(a => [`${a.trainingId}:${a.employeeId}`, a.attended]));
  return { trainings, requests, dayMap, overallMap };
}

function send(buf: ExcelJS.Buffer, name: string) {
  return new NextResponse(Buffer.from(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\w .()-]/g, "_")}.xlsx"`,
      "Cache-Control": "no-store"
    }
  });
}

/* ------------- One training, matching "NESR Training Attendance Template.xlsx" ------------- */
async function oneTraining(id: string, actorId: string) {
  const { trainings, requests, dayMap, overallMap } = await loadAttendance({ id });
  const t = trainings[0];
  if (!t) return NextResponse.json({ error: "Training not found." }, { status: 404 });
  const days = trainingDays(iso(t.startDate), iso(t.endDate));
  const people = requests.map(r => r.employee).sort((a, b) => a.name.localeCompare(b.name));

  const wb = new ExcelJS.Workbook();
  wb.creator = "NESR Training Portal";
  const ws = wb.addWorksheet("Attendance", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  const firstDay = 6, lastCol = firstDay + days.length;          // B..E fixed, then one column per day, then Overall
  ws.columns = [{ width: 3 }, { width: 6 }, { width: 14 }, { width: 40 }, { width: 18 }, ...days.map(() => ({ width: 18 })), { width: 14 }];

  // Logo band
  ws.mergeCells(1, 2, 3, lastCol);
  ws.getCell(1, 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
  for (let r = 1; r <= 3; r++) ws.getRow(r).height = 16;
  const logo = wb.addImage({ buffer: await fs.readFile(path.join(process.cwd(), "public/assets/nesr-logo-white.png")) as unknown as ExcelJS.Buffer, extension: "png" });
  ws.addImage(logo, { tl: { col: 1.2, row: 0.15 }, ext: { width: 54, height: 42 } }); // keeps the logo's 2038 × 1587 proportions

  ws.mergeCells(5, 2, 5, lastCol);
  Object.assign(ws.getCell(5, 2), { value: "Training Attendance Sheet" });
  ws.getCell(5, 2).font = { bold: true, size: 16, color: { argb: GREEN } };
  ws.getCell(5, 2).alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(5).height = 26;

  const mid = Math.max(firstDay, Math.ceil((2 + lastCol) / 2));
  const info: [number, number, string][] = [
    [6, 2, `Location: ${t.location}`], [6, mid, `Course Title: ${t.title}`],
    [7, 2, `Date: ${longDateRange(iso(t.startDate), iso(t.endDate))}`], [7, mid, `Course Duration: ${days.length} Day${days.length === 1 ? "" : "s"}`],
    [8, 2, `Instructor Name: ${t.instructor || ""}`], [8, mid, `Course Code: ${t.code}`]
  ];
  for (const [r, c, v] of info) { const cell = ws.getCell(r, c); cell.value = v; cell.font = { bold: true, size: 11 }; }
  [6, 7, 8].forEach(r => (ws.getRow(r).height = 22));

  const head = ["No.", "Employee ID", "Employee Name", "Work Location", ...days.map((d, i) => `Day ${i + 1}\n${longDate(d)}`), "Overall"];
  const hr = ws.getRow(10);
  head.forEach((h, i) => {
    const cell = hr.getCell(2 + i);
    cell.value = h;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = box;
  });
  hr.height = 36;

  people.forEach((p, i) => {
    const row = ws.getRow(11 + i);
    const marks = days.map(d => dayMap.get(`${t.id}:${p.id}:${d}`));
    const o = overallMap.get(`${t.id}:${p.id}`);
    const values = [i + 1, p.nesrId || "", p.name + (p.isExternal ? ` (${p.organization || "External"})` : ""), p.location || p.country || "",
      ...marks.map(m => (m === true ? "✓" : m === false ? "Absent" : "")), o === true ? "Attended" : o === false ? "No show" : ""];
    values.forEach((v, j) => {
      const cell = row.getCell(2 + j);
      cell.value = v;
      cell.border = box;
      cell.alignment = { vertical: "middle", horizontal: j === 2 || j === 3 ? "left" : "center", wrapText: true };
      if (v === "✓") cell.font = { bold: true, color: { argb: GREEN }, size: 13 };
      if (v === "Absent" || v === "No show") cell.font = { color: { argb: "FF8A2B2B" } };
      if (i % 2) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F9F8" } };
    });
    row.height = 26;
  });
  ws.views = [{ state: "frozen", ySplit: 10 }];

  await prisma.auditLog.create({ data: { actorId, action: "export_attendance", entity: "training", entityId: t.id, details: { rows: people.length } } });
  return send(await wb.xlsx.writeBuffer(), `Attendance - ${t.code}`);
}

/* ------------------------------- Consolidated ------------------------------- */
async function consolidated(q: URLSearchParams, actorId: string) {
  const year = Number(q.get("year")) || new Date().getUTCFullYear();
  const quarter = /^Q[1-4]$/.test(q.get("quarter") || "") ? q.get("quarter")! : "";
  const type = (q.get("type") || "").slice(0, 60);

  let from = new Date(Date.UTC(year, 0, 1)), to = new Date(Date.UTC(year + 1, 0, 1));
  if (quarter) {
    const qi = Number(quarter[1]) - 1;
    from = new Date(Date.UTC(year, qi * 3, 1)); to = new Date(Date.UTC(year, qi * 3 + 3, 1));
  }
  const { trainings, requests, dayMap, overallMap } = await loadAttendance({
    isActive: true, status: { not: "cancelled" }, startDate: { gte: from, lt: to }, ...(type ? { type } : {})
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "NESR Training Portal";

  // Sheet 1: one row per training
  const sum = wb.addWorksheet("Summary");
  sum.columns = [
    { header: "Training Code", key: "code", width: 13 }, { header: "Training", key: "title", width: 40 },
    { header: "Type of Training", key: "type", width: 16 }, { header: "Training Category", key: "category", width: 24 },
    { header: "Quarter", key: "quarter", width: 9 }, { header: "Month", key: "month", width: 8 },
    { header: "Start Date", key: "start", width: 13, style: { numFmt: "dd/mm/yyyy" } }, { header: "End Date", key: "end", width: 13, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Location", key: "location", width: 20 }, { header: "Days", key: "days", width: 7 },
    { header: "Registered", key: "registered", width: 11 }, { header: "Attended", key: "attended", width: 10 },
    { header: "No show", key: "noShow", width: 10 }, { header: "Not marked", key: "unmarked", width: 11 },
    { header: "Attendance Rate", key: "rate", width: 14, style: { numFmt: "0%" } }
  ];
  // Sheet 2: one row per participant per training
  const det = wb.addWorksheet("Participants");
  det.columns = [
    { header: "Training Code", key: "code", width: 13 }, { header: "Training", key: "title", width: 38 },
    { header: "Type of Training", key: "type", width: 16 }, { header: "Quarter", key: "quarter", width: 9 },
    { header: "Start Date", key: "start", width: 13, style: { numFmt: "dd/mm/yyyy" } }, { header: "Location", key: "location", width: 20 },
    { header: "Employee ID", key: "nesrId", width: 12 }, { header: "Employee Name", key: "name", width: 30 },
    { header: "Department", key: "department", width: 22 }, { header: "Work Location", key: "workLocation", width: 18 },
    { header: "Organization", key: "org", width: 13 }, { header: "Days Present", key: "present", width: 12 },
    { header: "Total Days", key: "total", width: 10 }, { header: "Overall", key: "overall", width: 12 }
  ];

  for (const t of trainings) {
    const days = trainingDays(iso(t.startDate), iso(t.endDate));
    const people = requests.filter(r => r.trainingId === t.id).map(r => r.employee).sort((a, b) => a.name.localeCompare(b.name));
    let attended = 0, noShow = 0;
    for (const p of people) {
      const o = overallMap.get(`${t.id}:${p.id}`);
      if (o === true) attended++; else if (o === false) noShow++;
      det.addRow({
        code: t.code, title: t.title, type: t.type, quarter: quarterOf(t.startDate), start: t.startDate, location: t.location,
        nesrId: p.nesrId || "", name: p.name, department: p.department || "", workLocation: p.location || p.country || "",
        org: p.isExternal ? p.organization || "External" : "NESR",
        present: days.filter(d => dayMap.get(`${t.id}:${p.id}:${d}`) === true).length, total: days.length,
        overall: o === true ? "Attended" : o === false ? "No show" : ""
      });
    }
    sum.addRow({
      code: t.code, title: t.title, type: t.type, category: t.category, quarter: quarterOf(t.startDate), month: MONTHS[t.startDate.getUTCMonth()],
      start: t.startDate, end: t.endDate, location: t.location, days: days.length,
      registered: people.length, attended, noShow, unmarked: people.length - attended - noShow,
      rate: attended + noShow ? attended / (attended + noShow) : null
    });
  }

  for (const ws of [sum, det]) {
    const row = ws.getRow(1);
    row.font = { bold: true, color: { argb: "FFFFFFFF" } };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    row.alignment = { vertical: "middle", wrapText: true };
    row.height = 30;
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
  }
  sum.getColumn("rate").eachCell((c, n) => { if (n > 1) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALE } }; });

  await prisma.auditLog.create({ data: { actorId, action: "export_attendance", entity: "report", entityId: "all", details: { year, quarter, type, trainings: trainings.length } } });
  return send(await wb.xlsx.writeBuffer(), `Attendance report ${year}${quarter ? " " + quarter : ""}${type ? " " + type : ""}`);
}
