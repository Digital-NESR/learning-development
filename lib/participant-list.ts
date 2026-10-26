import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// Participant list for one training, A4 landscape, table that continues across pages.

export type ListRow = { name: string; nesrId: string; department: string; email: string; status: string; attendance: string };
export type ListInfo = { code: string; title: string; dates: string; location: string; instructor: string; seats: string; summary: string };

const W = 841.89, H = 595.28, M = 36;
const GREEN = rgb(0x2a / 255, 0x7e / 255, 0x4f / 255);
const DARK = rgb(0x1f / 255, 0x1f / 255, 0x1d / 255);
const GREY = rgb(0x58 / 255, 0x59 / 255, 0x5b / 255);
const LINE = rgb(0.88, 0.9, 0.89);
const ZEBRA = rgb(0.98, 0.984, 0.98);

const COLS: { key: keyof ListRow | "n"; label: string; w: number }[] = [
  { key: "n", label: "#", w: 28 },
  { key: "name", label: "Name", w: 170 },
  { key: "nesrId", label: "NESR ID", w: 70 },
  { key: "department", label: "Department", w: 130 },
  { key: "email", label: "Email", w: 196 },
  { key: "status", label: "Status", w: 90 },
  { key: "attendance", label: "Attendance", w: W - 2 * M - 684 }
];

/** Keeps only characters the standard PDF font can draw. */
function clean(font: PDFFont, s: string) {
  return Array.from(String(s ?? "").normalize("NFC")).map(ch => {
    try { font.encodeText(ch); return ch; } catch { return ch === "–" || ch === "—" ? "-" : ""; }
  }).join("");
}

/** Shortens text with "..." to fit a column. */
function fit(font: PDFFont, s: string, size: number, width: number) {
  let t = clean(font, s);
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  while (t.length > 1 && font.widthOfTextAtSize(t + "...", size) > width) t = t.slice(0, -1);
  return t + "...";
}

export async function participantListPdf(info: ListInfo, rows: ListRow[]) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Participants - ${info.code}`);
  doc.setAuthor("NESR Training Portal");
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const generated = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

  let page!: PDFPage, y = 0, pageNo = 0;
  const header = (first: boolean) => {
    page = doc.addPage([W, H]);
    pageNo++;
    page.drawRectangle({ x: 0, y: H - 46, width: W, height: 46, color: GREEN });
    page.drawText("NESR", { x: M, y: H - 30, size: 18, font: bold, color: rgb(1, 1, 1) });
    page.drawText("TRAINING", { x: M + bold.widthOfTextAtSize("NESR", 18) + 6, y: H - 29, size: 9, font: reg, color: rgb(1, 1, 1) });
    const tag = "PARTICIPANT LIST";
    page.drawText(tag, { x: W - M - bold.widthOfTextAtSize(tag, 9), y: H - 28, size: 9, font: bold, color: rgb(1, 1, 1) });
    y = H - 46 - 26;
    if (first) {
      page.drawText(clean(reg, info.code), { x: M, y, size: 10, font: reg, color: GREY });
      y -= 20;
      page.drawText(fit(bold, info.title, 17, W - 2 * M), { x: M, y, size: 17, font: bold, color: DARK });
      y -= 18;
      const meta = [info.dates, info.location, info.instructor && "Instructor: " + info.instructor, info.seats].filter(Boolean).join("   |   ");
      page.drawText(fit(reg, meta, 10, W - 2 * M), { x: M, y, size: 10, font: reg, color: GREY });
      y -= 15;
      page.drawText(fit(bold, info.summary, 10, W - 2 * M), { x: M, y, size: 10, font: bold, color: GREEN });
      y -= 20;
    } else {
      page.drawText(fit(bold, `${info.code} · ${info.title} (continued)`, 11, W - 2 * M), { x: M, y, size: 11, font: bold, color: DARK });
      y -= 18;
    }
    // Column headings
    page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: rgb(0.93, 0.95, 0.94) });
    let x = M + 6;
    for (const c of COLS) { page.drawText(c.label, { x, y, size: 9, font: bold, color: GREY }); x += c.w; }
    y -= 22;
  };
  const footer = () => {
    const text = `Generated ${generated} from the NESR Training Portal   ·   Page ${pageNo}`;
    page.drawText(text, { x: M, y: 20, size: 8, font: reg, color: GREY });
  };

  header(true);
  if (!rows.length) {
    page.drawText("No one is registered for this training yet.", { x: M + 6, y, size: 10, font: reg, color: GREY });
  }
  rows.forEach((r, i) => {
    if (y < 46) { footer(); header(false); }
    if (i % 2) page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: ZEBRA });
    let x = M + 6;
    for (const c of COLS) {
      const v = c.key === "n" ? String(i + 1) : r[c.key];
      page.drawText(fit(c.key === "name" ? bold : reg, v || "-", 9, c.w - 8), { x, y, size: 9, font: c.key === "name" ? bold : reg, color: DARK });
      x += c.w;
    }
    page.drawLine({ start: { x: M, y: y - 6 }, end: { x: W - M, y: y - 6 }, thickness: 0.5, color: LINE });
    y -= 20;
  });
  footer();
  return doc.save();
}
