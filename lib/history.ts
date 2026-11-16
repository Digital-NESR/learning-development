import "server-only";
import ExcelJS from "exceljs";

// Reads L&D's consolidated training-history workbook.
// Accepts either layout, on any sheet:
//   long:  Employee ID | Name | Training Title            (one row per training)
//   wide:  Employee ID | Name | Training 1 | Training 2 … (one row per person)
// The year comes from the end of the title ("Basic Pumping - 2024") or from a "Year" column.

/** NESR IDs are compared as digits without leading zeros ("016328" = "16328"). "Unknown" / "NA" → null. */
export function normId(v: unknown): string | null {
  const d = String(v ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return d || null;
}
export const nameKey = (v: unknown) => String(v ?? "").replace(/[\s ]+/g, " ").trim().toLowerCase();
/** Words of a name (3+ letters), for checking that an ID match is the same person: "Al-Harbi" → ["harbi"]. */
export const nameWords = (v: unknown) => nameKey(v).split(/[^a-zÀ-ɏ؀-ۿ]+/).filter(w => w.length >= 3);
const clean = (v: string) => v.replace(/[\s ]+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "object") {
    if (v instanceof Date) return String(v.getUTCFullYear());
    if ("richText" in v) return v.richText.map(p => p.text).join("");
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    if ("text" in v) return String(v.text);
    return "";
  }
  return String(v);
}

export type HistoryRow = { nesrId: string | null; name: string; nameKey: string; title: string; year: number | null };
export type ParsedHistory = {
  sheet: string; rows: HistoryRow[];
  people: number; noYear: number; noId: number; duplicates: number; sheetsFound: string[];
};

function readSheet(ws: ExcelJS.Worksheet) {
  // Header: the first of the top 10 rows with an employee-ID column
  let headerRow = 0, idCol = 0, nameCol = 0, yearCol = 0;
  let titleCols: number[] = [];
  for (let r = 1; r <= Math.min(10, ws.rowCount) && !headerRow; r++) {
    const row = ws.getRow(r);
    const cols: Record<number, string> = {};
    row.eachCell((c, i) => { cols[i] = cellText(c.value).trim().toLowerCase(); });
    const id = Object.keys(cols).map(Number).find(i => /(employee|emp|nesr|staff)\s*(id|no|number|#)/.test(cols[i]) || cols[i] === "id");
    if (!id) continue;
    headerRow = r; idCol = id;
    nameCol = Object.keys(cols).map(Number).find(i => i !== id && /name/.test(cols[i]) && !/training|course/.test(cols[i])) || 0;
    yearCol = Object.keys(cols).map(Number).find(i => /^year$|completion year/.test(cols[i])) || 0;
    titleCols = Object.keys(cols).map(Number).filter(i => i !== id && i !== nameCol && i !== yearCol && /training|course|program|title/.test(cols[i]));
  }
  if (!headerRow || !titleCols.length) return null;

  const rows: HistoryRow[] = [];
  const seen = new Set<string>();
  let noYear = 0, noId = 0, duplicates = 0;
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = clean(cellText(row.getCell(nameCol || idCol + 1).value));
    const nesrId = normId(cellText(row.getCell(idCol).value));
    if (!name && !nesrId) continue;
    const colYear = yearCol ? Number(cellText(row.getCell(yearCol).value).match(/(19|20)\d\d/)?.[0]) || null : null;
    for (const c of titleCols) {
      const raw = clean(cellText(row.getCell(c).value));
      if (!raw) continue;
      const m = raw.match(/^(.*?)\s*[-–—]\s*((?:19|20)\d\d)$/);
      const title = (m ? m[1] : raw).slice(0, 300);
      const year = m ? Number(m[2]) : colYear;
      const key = (nesrId || "n:" + nameKey(name)) + "|" + title.toLowerCase() + "|" + (year ?? "");
      if (seen.has(key)) { duplicates++; continue; }
      seen.add(key);
      if (!year) noYear++;
      if (!nesrId) noId++;
      rows.push({ nesrId, name: name.slice(0, 160) || "(no name)", nameKey: nameKey(name), title, year });
    }
  }
  return { rows, noYear, noId, duplicates };
}

/**
 * Parses the workbook. When several sheets match (e.g. a raw list and a consolidated copy of the same data),
 * a sheet named "Consolidated…" wins (it is L&D's cleaned copy); otherwise the one with the most records.
 */
export async function parseHistoryWorkbook(buf: ArrayBuffer): Promise<ParsedHistory | null> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  let best: (ReturnType<typeof readSheet> & { sheet: string }) | null = null;
  const sheetsFound: string[] = [];
  for (const ws of wb.worksheets) {
    const got = readSheet(ws);
    if (!got || !got.rows.length) continue;
    sheetsFound.push(ws.name);
    const cons = /consolidated/i.test(ws.name), bestCons = !!best && /consolidated/i.test(best.sheet);
    const better = !best || (cons && !bestCons) || (cons === bestCons && got.rows.length > best.rows.length);
    if (better) best = { ...got, sheet: ws.name };
  }
  if (!best) return null;
  const people = new Set(best.rows.map(r => r.nesrId || "n:" + r.nameKey)).size;
  return { sheet: best.sheet, rows: best.rows, people, noYear: best.noYear, noId: best.noId, duplicates: best.duplicates, sheetsFound };
}
