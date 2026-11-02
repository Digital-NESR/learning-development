import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// Certificates of completion from L&D's two PowerPoint templates (templates/cert-*.pptx).
// PDF: a high-resolution render of the template with the variable text removed (templates/cert-*-bg.jpg),
//      with names and dates drawn on top at the template's positions.
// PowerPoint: the template itself, one slide per person, text replaced — fully editable.
// Coordinates are in points on the template's 780 × 540 pt slide, measured from the top.

export type CertBrand = "nesr" | "cpven";
export type CertInput = {
  brand: CertBrand;
  names: string[];
  course: string;
  dates: string;              // "25 - 29 October 2026, Cairo"
  instructorName: string;
  instructorTitle: string;
  signature?: { bytes: Uint8Array; type: "png" | "jpg" } | null;
};

const W = 780, H = 540, EMU = 12700;
const BLACK = rgb(0, 0, 0);

type Layout = {
  name: { y: number; size: number };
  course: { y: number; size: number; bold: boolean };
  dates: { y: number; size: number };
  instructor: { x: number; nameY: number; titleY: number; nameSize: number; titleSize: number; bold: boolean };
  signature: { x: number; bottom: number };
  shapes: { name: string; course: string; instructor: string; clear: string[] };
};

const LAYOUT: Record<CertBrand, Layout> = {
  nesr: {
    name: { y: 289, size: 24 },
    course: { y: 350, size: 24, bold: true },
    dates: { y: 374, size: 14 },
    instructor: { x: 160, nameY: 489, titleY: 511, nameSize: 16, titleSize: 16, bold: false },
    signature: { x: 172, bottom: 466 },
    shapes: { name: "TextBox 18", course: "TextBox 19", instructor: "TextBox 17", clear: ["TextBox 4"] }
  },
  cpven: {
    name: { y: 292, size: 24 },
    course: { y: 355, size: 20, bold: true },
    dates: { y: 373, size: 14 },
    instructor: { x: 171, nameY: 497, titleY: 514, nameSize: 16, titleSize: 14, bold: true },
    signature: { x: 171, bottom: 470 },
    shapes: { name: "TextBox 12", course: "TextBox 19", instructor: "TextBox 17", clear: [] }
  }
};

const TEMPLATE_DIR = path.join(process.cwd(), "templates");

/* ---------------------------------- PDF ---------------------------------- */

const FALLBACK: Record<string, string> = { "–": "-", "—": "-", "‘": "'", "’": "'", "“": '"', "”": '"', " ": " " };
function printable(font: PDFFont, text: string) {
  return Array.from(text.normalize("NFC")).map(ch => {
    try { font.encodeText(ch); return ch; } catch { /* not in the font */ }
    const alt = FALLBACK[ch] ?? ch.normalize("NFD").replace(/[^ -~]/g, "");
    try { font.encodeText(alt); return alt; } catch { return ""; }
  }).join("").replace(/ +/g, " ").trim();
}

function fitSize(font: PDFFont, text: string, max: number, maxWidth: number, min: number) {
  let size = max;
  while (size > min && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.5;
  return size;
}

function wrap(font: PDFFont, text: string, size: number, maxWidth: number) {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? cur + " " + w : w;
    if (font.widthOfTextAtSize(next, size) <= maxWidth || !cur) cur = next;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}

/** Draws text centred on x, with its baseline `top` points from the top of the page. */
function centred(page: PDFPage, text: string, x: number, top: number, size: number, font: PDFFont) {
  page.drawText(text, { x: x - font.widthOfTextAtSize(text, size) / 2, y: H - top, size, font, color: BLACK });
}

export async function certificatePdf(input: CertInput) {
  const L = LAYOUT[input.brand];
  const doc = await PDFDocument.create();
  doc.setTitle("Certificates of Completion - " + input.course);
  doc.setAuthor("NESR Training Portal");
  const bg = await doc.embedJpg(await fs.readFile(path.join(TEMPLATE_DIR, `cert-${input.brand}-bg.jpg`)));
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const sig = input.signature
    ? input.signature.type === "png" ? await doc.embedPng(input.signature.bytes) : await doc.embedJpg(input.signature.bytes)
    : null;

  const course = printable(bold, input.course);
  const dates = printable(regular, input.dates);
  const instName = printable(L.instructor.bold ? bold : regular, input.instructorName);
  const instTitle = printable(L.instructor.bold ? bold : regular, input.instructorTitle);

  // Long course titles shrink, then wrap onto a second line (pushing the dates down)
  const courseFont = L.course.bold ? bold : regular;
  let courseSize = fitSize(courseFont, course, L.course.size, 470, 18);
  let courseLines = [course];
  if (courseFont.widthOfTextAtSize(course, courseSize) > 470) {
    courseSize = 17;
    courseLines = wrap(courseFont, course, courseSize, 470).slice(0, 2);
  }

  for (const raw of input.names) {
    const page = doc.addPage([W, H]);
    page.drawImage(bg, { x: 0, y: 0, width: W, height: H });

    const name = printable(bold, raw);
    centred(page, name, W / 2, L.name.y, fitSize(bold, name, L.name.size, 480, 14), bold);

    courseLines.forEach((line, i) => centred(page, line, W / 2, L.course.y + i * courseSize * 1.15, courseSize, courseFont));
    const extra = (courseLines.length - 1) * courseSize * 1.15;
    centred(page, dates, W / 2, L.dates.y + extra, fitSize(regular, dates, L.dates.size, 470, 10), regular);

    const f = L.instructor.bold ? bold : regular;
    if (instName) centred(page, instName, L.instructor.x, L.instructor.nameY, fitSize(f, instName, L.instructor.nameSize, 190, 10), f);
    if (instTitle) centred(page, instTitle, L.instructor.x, L.instructor.titleY, fitSize(f, instTitle, L.instructor.titleSize, 190, 9), f);

    if (sig) {
      const s = Math.min(130 / sig.width, 46 / sig.height);
      const w = sig.width * s, h = sig.height * s;
      page.drawImage(sig, { x: L.signature.x - w / 2, y: H - L.signature.bottom, width: w, height: h });
    }
  }
  return doc.save();
}

/* ------------------------------- PowerPoint ------------------------------- */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Finds the <p:sp> shape with this name (searching inside groups too). */
function shapeRange(xml: string, name: string) {
  const at = xml.indexOf(`name="${name}"`);
  if (at < 0) return null;
  const start = xml.lastIndexOf("<p:sp>", at);
  const end = xml.indexOf("</p:sp>", at) + "</p:sp>".length;
  return { start, end };
}

/** Replaces the text of a shape's first paragraphs, keeping each paragraph's main run formatting. */
function setText(xml: string, name: string, texts: string[], opts: { widen?: boolean; centre?: boolean } = {}) {
  const r = shapeRange(xml, name);
  if (!r) return xml;
  let sp = xml.slice(r.start, r.end);
  let k = 0;
  sp = sp.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (whole, inner: string) => {
    const i = k++;
    if (i >= texts.length) return whole;
    const runs = inner.match(/<a:r>[\s\S]*?<\/a:r>/g) || [];
    if (!runs.length) return whole;
    // Keep the run with the most text (the placeholder's real formatting), drop the rest
    const keep = runs.reduce((a, b) => ((b.match(/<a:t>([^<]*)<\/a:t>/)?.[1] || "").trim().length > (a.match(/<a:t>([^<]*)<\/a:t>/)?.[1] || "").trim().length ? b : a));
    const run = keep.replace(/<a:t>[^<]*<\/a:t>/, `<a:t>${esc(texts[i])}</a:t>`).replace(/ err="1"/g, "");
    let body = inner;
    runs.forEach((x, j) => { body = body.replace(x, j === 0 ? "\u0000" : ""); });
    body = body.replace("\u0000", run);
    if (opts.centre && !/<a:pPr[^>]*algn=/.test(body)) body = /^<a:pPr/.test(body) ? body.replace("<a:pPr", `<a:pPr algn="ctr"`) : `<a:pPr algn="ctr"/>` + body;
    return `<a:p>${body}</a:p>`;
  });
  if (opts.widen) {
    // Full-width, wrapping text box centred on the slide, so long names and titles stay centred
    const cx = 7000000, x = Math.round((W * EMU - cx) / 2);
    sp = sp.replace(/<a:off x="\d+" y="(\d+)"\/><a:ext cx="\d+"/, `<a:off x="${x}" y="$1"/><a:ext cx="${cx}"`)
      .replace(/<a:bodyPr wrap="none"/, `<a:bodyPr wrap="square"`);
  }
  return xml.slice(0, r.start) + sp + xml.slice(r.end);
}

function signaturePic(rId: string, x: number, bottom: number, w: number, h: number) {
  const e = (v: number) => Math.round(v * EMU);
  return `<p:pic><p:nvPicPr><p:cNvPr id="900" name="Instructor Signature"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`
    + `<p:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>`
    + `<p:spPr><a:xfrm><a:off x="${e(x - w / 2)}" y="${e(bottom - h)}"/><a:ext cx="${e(w)}" cy="${e(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

export async function certificatePptx(input: CertInput) {
  const L = LAYOUT[input.brand];
  const zip = await JSZip.loadAsync(await fs.readFile(path.join(TEMPLATE_DIR, `cert-${input.brand}.pptx`)));
  const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  const slideRels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");

  // Signature image (same file shared by every slide)
  let sigRel = "", sigPic = "";
  if (input.signature) {
    const ext = input.signature.type === "png" ? "png" : "jpeg";
    zip.file(`ppt/media/instructor-signature.${ext}`, input.signature.bytes);
    const probe = await PDFDocument.create();
    const img = input.signature.type === "png" ? await probe.embedPng(input.signature.bytes) : await probe.embedJpg(input.signature.bytes);
    const s = Math.min(130 / img.width, 46 / img.height);
    sigRel = `<Relationship Id="rIdSig" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/instructor-signature.${ext}"/>`;
    sigPic = signaturePic("rIdSig", L.signature.x, L.signature.bottom, img.width * s, img.height * s);
  }

  // One slide per person
  zip.remove("ppt/slides/slide1.xml");
  zip.remove("ppt/slides/_rels/slide1.xml.rels");
  input.names.forEach((name, i) => {
    let xml = slideXml;
    xml = setText(xml, L.shapes.name, [name], { widen: true, centre: true });
    xml = setText(xml, L.shapes.course, [input.course, input.dates], { widen: true });
    xml = setText(xml, L.shapes.instructor, [input.instructorName, input.instructorTitle]);
    for (const c of L.shapes.clear) xml = setText(xml, c, [""]);
    if (sigPic) xml = xml.replace("</p:spTree>", sigPic + "</p:spTree>");
    zip.file(`ppt/slides/slide${i + 1}.xml`, xml);
    zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, sigRel ? slideRels.replace("</Relationships>", sigRel + "</Relationships>") : slideRels);
  });

  // presentation.xml + its relationships: replace the single template slide with the new list
  let pres = await zip.file("ppt/presentation.xml")!.async("string");
  let presRels = await zip.file("ppt/_rels/presentation.xml.rels")!.async("string");
  presRels = presRels.replace(/<Relationship [^>]*Target="slides\/slide1\.xml"\/>/, "");
  const ids = input.names.map((_, i) => `<p:sldId id="${256 + i}" r:id="rIdCert${i + 1}"/>`).join("");
  pres = pres.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${ids}</p:sldIdLst>`);
  presRels = presRels.replace("</Relationships>", input.names.map((_, i) =>
    `<Relationship Id="rIdCert${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("") + "</Relationships>");
  zip.file("ppt/presentation.xml", pres);
  zip.file("ppt/_rels/presentation.xml.rels", presRels);

  // Content types
  let types = await zip.file("[Content_Types].xml")!.async("string");
  types = types.replace(/<Override PartName="\/ppt\/slides\/slide1\.xml"[^>]*\/>/, "");
  types = types.replace("</Types>", input.names.map((_, i) =>
    `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("") + "</Types>");
  zip.file("[Content_Types].xml", types);

  const app = zip.file("docProps/app.xml");
  if (app) zip.file("docProps/app.xml", (await app.async("string")).replace(/<Slides>\d+<\/Slides>/, `<Slides>${input.names.length}</Slides>`));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
