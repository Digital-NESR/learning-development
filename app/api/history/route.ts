import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { currentEmployee } from "@/auth";
import { prisma } from "@/lib/prisma";
import { normId, nameKey, parseHistoryWorkbook } from "@/lib/history";

export const runtime = "nodejs";
export const maxDuration = 60;

// Training history from before the portal (L&D only).
// GET  ?q=name or NESR ID   look up anyone's imported records
// POST multipart "file"     import the consolidated workbook; replaces all imported records

const MAX_FILE = 4 * 1024 * 1024;

export async function GET(req: Request) {
  const me = await currentEmployee();
  if (!me?.isAdmin) return NextResponse.json({ error: "Only the L&D team can search training history." }, { status: 403 });
  const q = (new URL(req.url).searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ people: [] });
  const id = /^\d+$/.test(q) ? normId(q) : null;
  const where: Prisma.TrainingHistoryWhereInput = id ? { nesrId: id } : { nameKey: { contains: nameKey(q) } };
  const rows = await prisma.trainingHistory.findMany({ where, orderBy: [{ name: "asc" }, { year: "desc" }, { title: "asc" }], take: 400 });
  const people = new Map<string, { nesrId: string; name: string; trainings: { title: string; year: number | null }[] }>();
  for (const r of rows) {
    const k = r.nesrId || "n:" + r.nameKey;
    if (!people.has(k)) people.set(k, { nesrId: r.nesrId || "", name: r.name, trainings: [] });
    people.get(k)!.trainings.push({ title: r.title, year: r.year });
  }
  return NextResponse.json({ people: [...people.values()].slice(0, 40), more: people.size > 40 });
}

export async function POST(req: Request) {
  const me = await currentEmployee();
  if (!me?.isAdmin) return NextResponse.json({ error: "Only the L&D team can import training history." }, { status: 403 });
  const f = await req.formData().catch(() => null);
  const file = f?.get("file");
  if (!file || typeof file === "string" || !file.size) return NextResponse.json({ error: "Choose the Excel file to import." }, { status: 400 });
  if (!/\.xlsx$/i.test(file.name)) return NextResponse.json({ error: "Upload the history as an Excel .xlsx file." }, { status: 400 });
  if (file.size > MAX_FILE) return NextResponse.json({ error: "The file is larger than 4 MB." }, { status: 400 });

  const parsed = await parseHistoryWorkbook(await file.arrayBuffer()).catch(() => null);
  if (!parsed) {
    return NextResponse.json({
      error: "No training records found. The sheet needs an \"Employee ID\" column, a \"Name\" column and either a \"Training Title\" column or \"Training 1\", \"Training 2\"… columns."
    }, { status: 400 });
  }

  // Replace everything in one transaction, so a failed import leaves the previous records in place
  const importedAt = new Date();
  await prisma.$transaction(async tx => {
    await tx.trainingHistory.deleteMany({});
    for (let i = 0; i < parsed.rows.length; i += 1000) {
      await tx.trainingHistory.createMany({ data: parsed.rows.slice(i, i + 1000).map(r => ({ ...r, importedAt })) });
    }
  }, { timeout: 50000 });

  const summary = {
    file: file.name, sheet: parsed.sheet, records: parsed.rows.length, people: parsed.people,
    noYear: parsed.noYear, noId: parsed.noId, duplicates: parsed.duplicates
  };
  await prisma.auditLog.create({ data: { actorId: me.id, action: "import", entity: "training_history", entityId: parsed.sheet, details: summary } });
  return NextResponse.json({ ok: true, ...summary });
}
