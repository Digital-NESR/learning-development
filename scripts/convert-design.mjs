// Converts the Claude Design template (design/LD Portal.dc.html) into a React view.
// Usage: node scripts/convert-design.mjs
// Output: components/PortalView.jsx and app/hover.css
//
// Template syntax handled:
//   {{ path }}                 -> {v.path} (or loop variable)
//   <sc-for list as>           -> array.map
//   <sc-if value>              -> conditional
//   style="a:b;c:{{ x }}"      -> style object
//   style-hover="..."          -> generated :hover class
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "design", "LD Portal.dc.html"), "utf8");

const start = src.indexOf("</helmet>") + "</helmet>".length;
const end = src.indexOf("</x-dc>");
const template = src.slice(start, end);

// --- tokenize -------------------------------------------------------------
const tokens = [];
const re = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*?>/g;
let last = 0, m;
while ((m = re.exec(template))) {
  if (m.index > last) tokens.push({ type: "text", value: template.slice(last, m.index) });
  if (!m[0].startsWith("<!--")) tokens.push({ type: "tag", value: m[0] });
  last = re.lastIndex;
}
if (last < template.length) tokens.push({ type: "text", value: template.slice(last) });

function parseTag(raw) {
  const closing = raw.startsWith("</");
  const selfClose = /\/>$/.test(raw);
  const body = raw.replace(/^<\/?/, "").replace(/\/?>$/, "");
  const name = body.match(/^[a-zA-Z][a-zA-Z0-9-]*/)[0];
  const attrs = [];
  const are = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)(?:\s*=\s*"([^"]*)")?/g;
  const rest = body.slice(name.length);
  let a;
  while ((a = are.exec(rest))) attrs.push({ name: a[1], value: a[2] });
  return { closing, selfClose, name, attrs };
}

// --- expressions ----------------------------------------------------------
const scope = [];
const usedTop = new Set();
function expr(p) {
  p = p.trim();
  if (p === "true" || p === "false") return p;
  const head = p.split(".")[0];
  if (scope.includes(head)) return p;
  usedTop.add(head);
  return "v." + p;
}
const EXPR = /\{\{\s*([^}]*?)\s*\}\}/g;
const isPureExpr = s => /^\s*\{\{[^}]*\}\}\s*$/.test(s);
function interp(s) {
  // returns a JS expression for a string with {{ }} parts
  if (isPureExpr(s)) return expr(s.replace(/^\s*\{\{|\}\}\s*$/g, ""));
  if (!s.includes("{{")) return JSON.stringify(s);
  EXPR.lastIndex = 0;
  return "`" + s.replace(/`/g, "\\`").replace(EXPR, (_, e) => "${" + expr(e) + "}") + "`";
}
const fixAssets = s => s.replace(/(^|url\(|")assets\//g, "$1/assets/");

// --- attributes -----------------------------------------------------------
const ATTR_MAP = {
  class: "className", for: "htmlFor", "stroke-width": "strokeWidth", "stroke-linejoin": "strokeLinejoin",
  "stroke-linecap": "strokeLinecap", "fill-rule": "fillRule", "clip-rule": "clipRule", tabindex: "tabIndex"
};
const camel = p => p.trim().replace(/^-(webkit|moz|ms)-/, (_, v) => v[0].toUpperCase() + v.slice(1) + "-")
  .replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function styleObj(s) {
  const parts = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === ";" && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  parts.push(cur);
  const props = parts.map(p => p.trim()).filter(Boolean).map(p => {
    const i = p.indexOf(":");
    return `${camel(p.slice(0, i))}: ${interp(fixAssets(p.slice(i + 1).trim()))}`;
  });
  return "{{ " + props.join(", ") + " }}";
}

const hoverRules = [];
function attrsToJsx(attrs) {
  const out = [];
  let hoverClass = null;
  for (const { name, value } of attrs) {
    if (name.startsWith("hint-")) continue;
    if (name === "style-hover") {
      hoverClass = "dc-h" + hoverRules.length;
      hoverRules.push(`.${hoverClass}:hover{${value.split(";").filter(Boolean).map(d => d + " !important").join(";")}}`);
      continue;
    }
    const jsxName = ATTR_MAP[name] || name;
    if (value === undefined) { out.push(jsxName); continue; }
    if (name === "style") { out.push(`style=${styleObj(value)}`); continue; }
    const v = fixAssets(value);
    if (v.includes("{{")) { out.push(`${jsxName}={${interp(v)}}`); }
    else out.push(`${jsxName}=${JSON.stringify(v)}`);
    EXPR.lastIndex = 0;
  }
  if (hoverClass) out.push(`className="${hoverClass}"`);
  return out.length ? " " + out.join(" ") : "";
}

// --- text -----------------------------------------------------------------
function textToJsx(t) {
  if (!t.trim()) return t.includes("\n") ? "\n" : t;
  let out = "";
  let i = 0;
  EXPR.lastIndex = 0;
  let mm;
  while ((mm = EXPR.exec(t))) {
    out += esc(t.slice(i, mm.index)) + "{" + expr(mm[1]) + "}";
    i = EXPR.lastIndex;
  }
  out += esc(t.slice(i));
  return out;
}
const esc = s => s.replace(/[{}>]/g, c => `{${JSON.stringify(c)}}`);

// --- walk -----------------------------------------------------------------
const VOID = new Set(["img", "input", "br", "hr", "meta"]);
let out = "";
const stack = [];
let forCount = 0;
for (const tok of tokens) {
  if (tok.type === "text") { out += textToJsx(tok.value); continue; }
  const tag = parseTag(tok.value);
  const get = n => (tag.attrs.find(a => a.name === n) || {}).value;
  if (tag.name === "sc-for") {
    if (tag.closing) { const { as } = stack.pop(); scope.splice(scope.lastIndexOf(as), 1); out += `</React.Fragment>))}`; continue; }
    const list = interp(get("list"));
    const as = get("as");
    const idx = "i" + forCount++;
    stack.push({ as });
    out += `{(${list} || []).map((${as}, ${idx}) => (<React.Fragment key={${idx}}>`;
    scope.push(as);
    continue;
  }
  if (tag.name === "sc-if") {
    if (tag.closing) { out += `</>) : null}`; continue; }
    out += `{${interp(get("value"))} ? (<>`;
    continue;
  }
  if (tag.closing) { out += `</${tag.name}>`; continue; }
  const selfClose = tag.selfClose || VOID.has(tag.name);
  out += `<${tag.name}${attrsToJsx(tag.attrs)}${selfClose ? " />" : ">"}`;
}

const file = `// GENERATED by scripts/convert-design.mjs from design/LD Portal.dc.html — do not edit by hand.
// Re-run \`npm run convert-design\` after updating the design file.
import React from "react";

export default function PortalView({ v }) {
  return (<>${out.trim()}</>);
}
`;
fs.writeFileSync(path.join(root, "components", "PortalView.jsx"), file);
fs.writeFileSync(path.join(root, "app", "hover.css"), "/* GENERATED by scripts/convert-design.mjs */\n" + hoverRules.join("\n") + "\n");

// global styles from <helmet>
const helmet = src.slice(src.indexOf("<helmet>"), src.indexOf("</helmet>"));
const css = helmet.replace(/^[\s\S]*?<style>/, "").replace(/<\/style>[\s\S]*$/, "");
fs.writeFileSync(path.join(root, "app", "design.css"), "/* GENERATED by scripts/convert-design.mjs */\n" + css.trim() + "\n");

console.log("PortalView.jsx written. Top-level values used:", [...usedTop].sort().join(", "));
