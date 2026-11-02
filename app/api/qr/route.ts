import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { currentEmployee } from "@/auth";
import { prisma } from "@/lib/prisma";
import { portalUrl } from "@/lib/notify";
import { qrSignature } from "@/lib/qr-token";
import { trainingDays, weekdayDate, longDateRange } from "@/lib/training-days.js";

export const runtime = "nodejs";

const GREEN = rgb(0x2a / 255, 0x7e / 255, 0x4f / 255);
const DARK = rgb(0x1f / 255, 0x1f / 255, 0x1d / 255);
const GREY = rgb(0x58 / 255, 0x59 / 255, 0x5b / 255);
const W = 595.28, H = 841.89;

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * GET /api/qr?id=<trainingId>&kind=checkin|survey — printable QR posters (L&D only).
 * checkin: one A4 page per training day; survey: one page for the whole training.
 */
export async function GET(req: Request) {
  const me = await currentEmployee();
  if (!me?.isAdmin) return NextResponse.json({ error: "Only the L&D team can print QR codes." }, { status: 403 });
  const q = new URL(req.url).searchParams;
  const kind = q.get("kind") === "survey" ? "survey" : "checkin";
  const t = await prisma.training.findUnique({ where: { id: q.get("id") || "" } });
  if (!t) return NextResponse.json({ error: "Training not found." }, { status: 404 });

  const base = await portalUrl();
  const doc = await PDFDocument.create();
  doc.setTitle(`${kind === "survey" ? "Feedback survey" : "Check-in"} QR - ${t.code}`);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const logo = await doc.embedPng(await fs.readFile(path.join(process.cwd(), "public/assets/nesr-logo-white.png")));
  const days = trainingDays(iso(t.startDate), iso(t.endDate));

  const pages = kind === "survey"
    ? [{ url: `${base}/survey?t=${t.id}&k=${qrSignature("survey", t.id)}`, heading: "Training Feedback Survey", when: longDateRange(iso(t.startDate), iso(t.endDate)),
         steps: ["Scan the code with your phone camera", "Sign in with your NESR Microsoft account", "Rate the training and press Submit — it takes 3 minutes"] }]
    : days.map((d, i) => ({ url: `${base}/checkin?t=${t.id}&d=${d}&k=${qrSignature("checkin", t.id, d)}`,
         heading: `Attendance — Day ${i + 1}${days.length > 1 ? " of " + days.length : ""}`, when: weekdayDate(d),
         steps: ["Scan the code with your phone camera", "Sign in with your NESR Microsoft account", "You'll see \"You're checked in\" — that's it"] }));

  for (const p of pages) {
    const page = doc.addPage([W, H]);
    page.drawRectangle({ x: 0, y: H - 92, width: W, height: 92, color: GREEN });
    const lh = 38, lw = (logo.width / logo.height) * lh;
    page.drawImage(logo, { x: 40, y: H - 46 - lh / 2, width: lw, height: lh });
    page.drawText("Training Portal", { x: 40 + lw + 18, y: H - 52, size: 15, font: bold, color: rgb(1, 1, 1) });

    centre(page, p.heading, H - 150, 26, bold, GREEN);
    let y = H - 186;
    for (const line of wrap(bold, `${t.code} · ${t.title}`, 17, W - 100).slice(0, 2)) { centre(page, line, y, 17, bold, DARK); y -= 22; }
    centre(page, p.when + (t.location ? " · " + t.location : ""), y - 2, 13, regular, GREY);

    const png = await QRCode.toBuffer(p.url, { type: "png", width: 1000, margin: 1, errorCorrectionLevel: "M" });
    const qr = await doc.embedPng(png);
    const size = 330;
    page.drawImage(qr, { x: (W - size) / 2, y: 250, width: size, height: size });

    let sy = 205;
    p.steps.forEach((s, i) => {
      const text = `${i + 1}.  ${s}`;
      page.drawText(text, { x: (W - 330) / 2, y: sy, size: 13, font: i === 0 ? bold : regular, color: DARK });
      sy -= 24;
    });
    centre(page, "Trouble scanning? Ask the L&D team in the room.", 90, 10.5, regular, GREY);
  }

  await prisma.auditLog.create({ data: { actorId: me.id, action: "qr", entity: "training", entityId: t.id, details: { kind, pages: pages.length } } });
  return new NextResponse(Buffer.from(await doc.save()), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${(kind === "survey" ? "Survey QR - " : "Check-in QR - ") + t.code.replace(/[^\w .-]/g, "_")}.pdf"`,
      "Cache-Control": "no-store"
    }
  });
}

function centre(page: PDFPage, text: string, y: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>) {
  const safe = text.replace(/[–—]/g, "-").replace(/[^\x20-\x7E·]/g, "");
  page.drawText(safe, { x: (W - font.widthOfTextAtSize(safe, size)) / 2, y, size, font, color });
}

function wrap(font: PDFFont, text: string, size: number, maxWidth: number) {
  const out: string[] = [];
  let cur = "";
  for (const w of text.replace(/[–—]/g, "-").split(/\s+/).filter(Boolean)) {
    const next = cur ? cur + " " + w : w;
    if (font.widthOfTextAtSize(next, size) <= maxWidth || !cur) cur = next;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}
