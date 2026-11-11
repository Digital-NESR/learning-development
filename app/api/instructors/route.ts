import { NextResponse } from "next/server";
import { currentEmployee } from "@/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// Instructor profiles under Resources.
// GET    ?id=…  the profile document (anyone signed in)
// POST   multipart form (L&D): id (to edit), name, title, bio, link, file, removeFile
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
  const p = await prisma.instructorProfile.findUnique({ where: { id } });
  if (!p?.fileData) return NextResponse.json({ error: "Profile document not found." }, { status: 404 });
  return new NextResponse(Buffer.from(p.fileData), {
    headers: {
      "Content-Type": p.fileType || "application/octet-stream",
      // PDFs open in the browser; Word / PowerPoint files download
      "Content-Disposition": `${p.fileType === TYPES.pdf ? "inline" : "attachment"}; filename="${(p.fileName || "profile").replace(/["\r\n]/g, "")}"`,
      "Cache-Control": "private, no-store"
    }
  });
}

export async function POST(req: Request) {
  const me = await currentEmployee();
  if (!me?.isAdmin) return NextResponse.json({ error: "Only the L&D team can edit instructor profiles." }, { status: 403 });
  const f = await req.formData().catch(() => null);
  if (!f) return NextResponse.json({ error: "The upload was too large or incomplete. Use a file under 4 MB." }, { status: 400 });

  const name = text(f.get("name"), 120);
  if (!name) return NextResponse.json({ error: "Enter the instructor's name." }, { status: 400 });
  let link = text(f.get("link"), 1000);
  if (link && !/^https?:\/\//i.test(link)) link = "https://" + link;

  const data: Record<string, unknown> = { name, title: text(f.get("title"), 160) || null, bio: text(f.get("bio"), 1500) || null, link: link || null };
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
  const existing = id ? await prisma.instructorProfile.findUnique({ where: { id }, select: { fileName: true } }) : null;
  if (id && !existing) return NextResponse.json({ error: "That profile no longer exists." }, { status: 404 });
  // A profile needs something to open
  const hasFile = "fileName" in data ? !!data.fileName : !!existing?.fileName;
  if (!link && !hasFile) return NextResponse.json({ error: "Add the profile document or a link to it." }, { status: 400 });

  const saved = id
    ? await prisma.instructorProfile.update({ where: { id }, data })
    : await prisma.instructorProfile.create({ data: data as { name: string } });
  await prisma.auditLog.create({ data: { actorId: me.id, action: id ? "update" : "create", entity: "instructor_profile", entityId: saved.id, details: { name } } });
  return NextResponse.json({ ok: true, id: saved.id });
}

export async function DELETE(req: Request) {
  const me = await currentEmployee();
  if (!me?.isAdmin) return NextResponse.json({ error: "Only the L&D team can remove instructor profiles." }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id") || "";
  const p = await prisma.instructorProfile.delete({ where: { id } }).catch(() => null);
  if (!p) return NextResponse.json({ error: "That profile no longer exists." }, { status: 404 });
  await prisma.auditLog.create({ data: { actorId: me.id, action: "delete", entity: "instructor_profile", entityId: id, details: { name: p.name } } });
  return NextResponse.json({ ok: true });
}
