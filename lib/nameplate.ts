import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

// Fold-in-half desk nameplate on A4 landscape. The bottom half is the front face;
// the top half is the same face rotated 180° so it reads correctly from the other side.

export type Nameplate = { name: string; course: string; date: string };

const W = 841.89, H = 595.28, FACE = H / 2;
const GREEN = rgb(0x2a / 255, 0x7e / 255, 0x4f / 255);
const DARK = rgb(0x1f / 255, 0x1f / 255, 0x1d / 255);
const GREY = rgb(0x58 / 255, 0x59 / 255, 0x5b / 255);
const LIGHT = rgb(0xc5 / 255, 0xe0 / 255, 0xd2 / 255);

/** Standard PDF fonts only cover Western characters; replace anything else so generation never fails. */
const FALLBACK: Record<string, string> = { "–": "-", "—": "-", "‘": "'", "’": "'", "“": '"', "”": '"', " ": " " };
function printable(font: PDFFont, text: string) {
  return Array.from(text.normalize("NFC")).map(ch => {
    try { font.encodeText(ch); return ch; } catch { /* not in the font */ }
    const alt = FALLBACK[ch] ?? ch.normalize("NFD").replace(/[^ -~]/g, "");
    try { font.encodeText(alt); return alt; } catch { return ""; }
  }).join("").replace(/ +/g, " ").trim();
}

function fitSize(font: PDFFont, text: string, max: number, maxWidth: number, min = 10) {
  let size = max;
  while (size > min && font.widthOfTextAtSize(text, size) > maxWidth) size -= 1;
  return size;
}

/** Splits text into at most `lines` lines that fit maxWidth. */
function wrap(font: PDFFont, text: string, size: number, maxWidth: number, lines = 2) {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? cur + " " + w : w;
    if (font.widthOfTextAtSize(next, size) <= maxWidth || !cur) cur = next;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  if (out.length > lines) {
    const kept = out.slice(0, lines);
    kept[lines - 1] = kept[lines - 1].replace(/\s*\S*$/, "") + "…";
    return kept;
  }
  return out;
}

function drawFace(page: PDFPage, flip: boolean, p: Nameplate, f: { bold: PDFFont; regular: PDFFont }, logo: PDFImage) {
  // Face coordinates: (0,0) bottom-left of the face, face "top" toward the fold in the middle of the page.
  const map = (x: number, y: number) => (flip ? { x: W - x, y: H - y } : { x, y });
  const rot = flip ? degrees(180) : degrees(0);
  const rect = (x: number, y: number, width: number, height: number, color: ReturnType<typeof rgb>) =>
    page.drawRectangle({ ...map(x, y), width, height, color, rotate: rot });
  const text = (t: string, x: number, y: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>) =>
    page.drawText(t, { ...map(x, y), size, font, color, rotate: rot });
  const centered = (t: string, y: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>) =>
    text(t, (W - font.widthOfTextAtSize(t, size)) / 2, y, size, font, color);

  // Green band along the fold edge, with logo and portal name
  const band = 58;
  rect(0, FACE - band, W, band, GREEN);
  const logoH = 30, logoW = (logo.width / logo.height) * logoH;
  page.drawImage(logo, { ...map(36, FACE - band + (band - logoH) / 2), width: logoW, height: logoH, rotate: rot });
  const tag = "Learning & Development";
  text(tag, W - 36 - f.bold.widthOfTextAtSize(tag, 13), FACE - band / 2 - 4.5, 13, f.bold, rgb(1, 1, 1));

  // Name, course and date, centred in the white area between the band and the bottom accent
  const maxWidth = W - 120;
  const name = printable(f.bold, p.name) || " ";
  const nameSize = fitSize(f.bold, name, 54, maxWidth, 18);
  const courseLines = wrap(f.regular, printable(f.regular, p.course), 18, maxWidth, 2);
  const date = printable(f.bold, p.date);
  const blockH = nameSize + (courseLines.length ? 20 + courseLines.length * 23 : 0) + (date ? 16 + 13 : 0);
  const top = FACE - band, bottom = 8;
  let y = (top + bottom) / 2 + blockH / 2 - nameSize * 0.8;
  centered(name, y, nameSize, f.bold, DARK);
  y -= nameSize * 0.2 + 20 + 18 * 0.8;
  for (const line of courseLines) { centered(line, y, 18, f.regular, GREY); y -= 23; }
  if (date) centered(date, y + 23 - 30, 13, f.bold, GREEN); // ~16pt below the last course line

  // Accent line along the table edge
  rect(0, 0, W, 8, LIGHT);
}

let logoBytes: Buffer | null = null;

export async function nameplatePdf(plates: Nameplate[]) {
  const doc = await PDFDocument.create();
  doc.setTitle(plates.length === 1 ? `Nameplate - ${plates[0].name}` : "Nameplates");
  doc.setAuthor("NESR Learning & Development Portal");
  const fonts = { bold: await doc.embedFont(StandardFonts.HelveticaBold), regular: await doc.embedFont(StandardFonts.Helvetica) };
  logoBytes ??= await fs.readFile(path.join(process.cwd(), "public", "assets", "nesr-logo-white.png"));
  const logo = await doc.embedPng(logoBytes);

  for (const p of plates) {
    const page = doc.addPage([W, H]);
    drawFace(page, false, p, fonts, logo);
    drawFace(page, true, p, fonts, logo);
    // Fold guide
    page.drawLine({ start: { x: 0, y: FACE }, end: { x: W, y: FACE }, thickness: 0.5, color: rgb(0.8, 0.82, 0.81), dashArray: [4, 4] });
  }
  return doc.save();
}
