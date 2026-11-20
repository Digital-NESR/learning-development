import { NextResponse } from "next/server";
import { currentEmployee } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CATEGORIES } from "@/lib/constants.js";

export const runtime = "nodejs";

// Training outlines under Resources.
// GET    ?id=…  the outline document (anyone signed in)
// POST   multipart form (L&D): id (to edit), title, category, link, file, removeFile
// DELETE ?id=…  (L&D)

/** Vercel accepts request bodies up to about 4.5 MB. */
const MAX_FILE = 4 * 1024 * 1024;
const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
};

const text = (v: FormDataEntryValue | null, max: number) => String(v ?? "").trim().slice(0, max);

export async function GET(req: Request) {
  if (!await currentEmployee()) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") || "";
  const o = await prisma.trainingOutline.findUnique({ where: { id } });
  if (!o?.fileData) return NextResponse.json({ error: "Outline not found." }, { status: 404 });
  return new NextResponse(Buffer.from(o.fileData), {
    headers: {
      "Content-Type": o.fileType || "application/octet-stream",
      // PDFs open in the browser; Word / PowerPoint files download
      "Content-Disposition": `${o.fileType === TYPES.pdf ? "inline" : "attachment"}; filename="${(o.fileName || "outline").replace(/["\r\n]/g, "")}"`,
      "Cache-Control": "private, no-store"
    }
  });
}

export async function POST(req: Request) {
  const me = await currentEmployee();
  if (!me?.isAdmin) return NextResponse.json({ error: "Only the L&D team can edit training outlines." }, { status: 403 });
  const f = await req.formData().catch(() => null);
  if (!f) return NextResponse.json({ error: "The upload was too large or incomplete. Use a file under 4 MB." }, { status: 400 });

  const title = text(f.get("title"), 200);
  if (!title) return NextResponse.json({ error: "Enter the training name." }, { status: 400 });
  const category = text(f.get("category"), 80);
  let link = text(f.get("link"), 1000);
  if (link && !/^https?:\/\//i.test(link)) link = "https://" + link;

  const data: Record<string, unknown> = { title, category: CATEGORIES.includes(category) ? category : null, link: link || null };
  const file = f.get("file");
  if (file && typeof file !== "string" && file.size > 0) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!TYPES[ext]) return NextResponse.json({ error: "Upload a PDF, Word or PowerPoint file." }, { status: 400 });
    if (file.size > MAX_FILE) return NextResponse.json({ error: "The file is larger than 4 MB. Save it as a smaller PDF, or add a link instead." }, { status: 400 });
    Object.assign(data, { fileName: file.name.slice(0, 200), fileType: TYPES[ext], fileData: Buffer.from(await file.arrayBuffer()) });
  } else if (f.get("removeFile") === "1") {
    Object.assign(data, { fileName: null, fileType: null, fileData: null });
  }

  const id = text(f.get("id"), 64);
  const existing = id ? await prisma.trainingOutline.findUnique({ where: { id }, select: { fileName: true } }) : null;
  if (id && !existing) return NextResponse.json({ error: "That outline no longer exists." }, { status: 404 });
  const hasFile = "fileName" in data ? !!data.fileName : !!existing?.fileName;
  if (!link && !hasFile) return NextResponse.json({ error: "Upload the outline or add a link to it." }, { status: 400 });

  const saved = id
    ? await prisma.trainingOutline.update({ where: { id }, data })
    : await prisma.trainingOutline.create({ data: data as { title: string } });
  await prisma.auditLog.create({ data: { actorId: me.id, action: id ? "update" : "create", entity: "training_outline", entityId: saved.id, details: { title } } });
  return NextResponse.json({ ok: true, id: saved.id });
}

export async function DELETE(req: Request) {
  const me = await currentEmployee();
  if (!me?.isAdmin) return NextResponse.json({ error: "Only the L&D team can remove training outlines." }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id") || "";
  const o = await prisma.trainingOutline.delete({ where: { id } }).catch(() => null);
  if (!o) return NextResponse.json({ error: "That outline no longer exists." }, { status: 404 });
  await prisma.auditLog.create({ data: { actorId: me.id, action: "delete", entity: "training_outline", entityId: id, details: { title: o.title } } });
  return NextResponse.json({ ok: true });
}
