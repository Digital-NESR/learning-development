import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { trainingDays } from "@/lib/training-days.js";
import { SHEET_TEMPLATES } from "@/lib/constants.js";

// Printable attendance sheet (Word) from L&D's templates (templates/attendance-*.docx).
// The template keeps its header (logo, "ATTENDANCE SHEET", instructor) and footer (instructor signature);
// the training details are written into its first table, and the attendance table is rebuilt for
// the training's days and participants. The instructor ticks each day by hand and signs.

export { SHEET_TEMPLATES };
export type SheetTemplate = "nesr" | "cpven" | "strategic" | "synapsco";

export type SheetInput = {
  template: SheetTemplate;
  title: string;
  start: string;            // YYYY-MM-DD
  end: string;
  location: string;
  instructor: string;
  people: { id: string; name: string; location: string }[];
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "01 July 2026", as in the template's day columns */
const sheetDate = (iso: string) => `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
/** "01 Jul 2026", short enough for the details line */
const shortDate = (iso: string) => `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1].slice(0, 3)} ${iso.slice(0, 4)}`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const DAYS_PER_TABLE = 5;
const MIN_ROWS = 15;          // the template's 15 rows fill one page
const TABLE_W = 15661, INDENT = -539;
const FIXED = { no: 681, id: 1443, name: 4194, loc: 1779 };

const run = (text: string, o: { bold?: boolean; size?: number } = {}) =>
  `<w:r><w:rPr>${o.bold ? "<w:b/><w:bCs/>" : ""}<w:sz w:val="${o.size ?? 21}"/><w:szCs w:val="${o.size ?? 21}"/><w:lang w:val="en-US"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const para = (runs: string, o: { center?: boolean; before?: number } = {}) =>
  `<w:p><w:pPr>${o.before ? `<w:spacing w:before="${o.before}"/>` : ""}${o.center ? `<w:jc w:val="center"/>` : ""}</w:pPr>${runs}</w:p>`;
const cell = (w: number, content: string, o: { head?: boolean } = {}) =>
  `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${o.head ? `<w:shd w:val="clear" w:color="auto" w:fill="BFBFBF"/><w:vAlign w:val="center"/>` : `<w:vAlign w:val="bottom"/>`}</w:tcPr>${content}</w:tc>`;

/** One attendance table covering up to five training days. */
function attendanceTable(days: string[], firstDay: number, people: SheetInput["people"]) {
  const dayW = Math.floor((TABLE_W - FIXED.no - FIXED.id - FIXED.name - FIXED.loc) / days.length);
  const widths = [FIXED.no, FIXED.id, FIXED.name, FIXED.loc, ...days.map(() => dayW)];
  const head = (lines: string[]) => lines.map(l => para(run(l, { bold: true, size: 22 }), { center: true })).join("");
  const header = `<w:tr><w:trPr><w:trHeight w:val="488"/><w:tblHeader/></w:trPr>`
    + cell(widths[0], head(["#"]), { head: true }) + cell(widths[1], head(["Employee ID"]), { head: true })
    + cell(widths[2], head(["Employee Name"]), { head: true }) + cell(widths[3], head(["Employee Location"]), { head: true })
    + days.map((d, i) => cell(dayW, head([`DAY ${firstDay + i}`, dayW >= 2000 ? sheetDate(d) : shortDate(d)]), { head: true })).join("") + `</w:tr>`;
  const rows = Array.from({ length: Math.max(MIN_ROWS, people.length + 3) }, (_, i) => {
    const p = people[i];
    return `<w:tr><w:trPr><w:trHeight w:val="395"/><w:cantSplit/></w:trPr>`
      + cell(widths[0], para(run(String(i + 1), { bold: true }), { center: true, before: 180 }))
      + cell(widths[1], para(p ? run(p.id) : "", { center: true, before: 180 }))
      + cell(widths[2], para(p ? run(p.name) : "", { before: 180 }))
      + cell(widths[3], para(p ? run(p.location, { size: 19 }) : "", { center: true, before: 180 }))
      + days.map(() => cell(dayW, para("", { before: 180 }))).join("") + `</w:tr>`;
  }).join("");
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${TABLE_W}" w:type="dxa"/><w:tblInd w:w="${INDENT}" w:type="dxa"/>`
    + `<w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>`
    + `<w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${header}${rows}</w:tbl>`;
}

/** Details table column widths, wider than the template's so each value stays on the label's line. */
const DETAIL_COLS = [4100, 150, 2700, 150, 2700, 150, 4400, 369];

/** Writes the training details after the labels in the template's details table (Name, Start, End, Location). */
function fillDetails(tbl: string, values: string[]) {
  let i = 0, g = 0, w = 0;
  if ((tbl.match(/<w:gridCol /g) || []).length === DETAIL_COLS.length) {
    tbl = tbl.replace(/<w:gridCol w:w="\d+"\/>/g, () => `<w:gridCol w:w="${DETAIL_COLS[g++]}"/>`)
      .replace(/<w:tcW w:w="\d+" w:type="dxa"\/>/g, () => `<w:tcW w:w="${DETAIL_COLS[w++] ?? 0}" w:type="dxa"/>`);
  }
  return tbl.replace(/<w:tc>[\s\S]*?<\/w:tc>/g, tc => {
    // Label cells are the ones with text; the narrow cells between them only draw the divider
    if (!/<w:t[ >]/.test(tc) || i >= values.length) return tc;
    const v = values[i++];
    const at = tc.lastIndexOf("</w:p>");
    const label = [...tc.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join("");
    return tc.slice(0, at) + run((label.endsWith(" ") ? "" : " ") + v, { bold: true, size: 22 }) + tc.slice(at);
  });
}

export async function attendanceSheetDocx(input: SheetInput) {
  const zip = await JSZip.loadAsync(await fs.readFile(path.join(process.cwd(), "templates", `attendance-${input.template}.docx`)));

  for (const name of Object.keys(zip.files).filter(n => /^word\/header\d*\.xml$/.test(n))) {
    const xml = await zip.file(name)!.async("string");
    if (xml.includes("{{instructor}}")) zip.file(name, xml.replace("{{instructor}}", esc(input.instructor)));
  }

  const doc = await zip.file("word/document.xml")!.async("string");
  const bodyStart = doc.indexOf("<w:body>") + "<w:body>".length;
  const details = doc.slice(bodyStart, doc.indexOf("</w:tbl>", bodyStart) + "</w:tbl>".length);
  // A slightly smaller bottom margin than the template's, so 15 rows fit even when the title wraps
  const sectPr = doc.slice(doc.lastIndexOf("<w:sectPr"), doc.indexOf("</w:body>")).replace(/w:bottom="1440"/, 'w:bottom="1100"');

  const days = trainingDays(input.start, input.end);
  const chunks: string[][] = [];
  for (let i = 0; i < days.length; i += DAYS_PER_TABLE) chunks.push(days.slice(i, i + DAYS_PER_TABLE));
  const spacer = `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>`;
  const pageBreak = `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
  const body = fillDetails(details, [input.title, shortDate(input.start), shortDate(input.end), input.location]) + spacer
    + chunks.map((c, i) => (i ? pageBreak : "") + attendanceTable(c, i * DAYS_PER_TABLE + 1, input.people)).join(spacer)
    // Word needs a paragraph after the last table; keep it tiny so it can't push onto a new page
    + `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>` + sectPr;

  zip.file("word/document.xml", doc.slice(0, bodyStart) + body + doc.slice(doc.indexOf("</w:body>")));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
