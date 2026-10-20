import "server-only";

// Branded HTML email (NESR green header, details table, button, dark footer).
// Built with tables and inline styles so it renders the same in Outlook desktop, Outlook web and phones.

const GREEN = "#2A7E4F";
const DARK = "#1F1F1D";
const FONT = "Arial, Helvetica, sans-serif";

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type EmailParts = {
  tag: string;               // right side of the header, e.g. "ENROLLMENT CONFIRMED"
  eyebrow: string;           // small line above the title, e.g. "SFT-02 · Training Portal"
  title: string;             // big headline
  firstName: string;
  message: string;           // plain text from the template, placeholders already filled
  details: [string, string][];
  buttonText: string;
  buttonUrl: string;
};

export function trainingEmailHtml(p: EmailParts) {
  // Skip our greeting if the template already starts with one
  const greets = /^\s*(hi|dear|hello)\b/i.test(p.message);
  const paragraphs = p.message.split(/\r?\n\s*\r?\n/).map(par => par.trim()).filter(Boolean)
    .map(par => `<p style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:22px;color:${DARK}">${esc(par).replace(/\r?\n/g, "<br>")}</p>`)
    .join("");

  const rows = p.details.map(([k, v], i) => `
              <tr>
                <td style="padding:12px 18px;width:34%;background:#F7F9F8;font-family:${FONT};font-size:14px;font-weight:bold;color:#58595B;${i ? "border-top:1px solid #E1E5E3;" : ""}">${esc(k)}</td>
                <td style="padding:12px 18px;font-family:${FONT};font-size:14px;color:${DARK};${i ? "border-top:1px solid #E1E5E3;" : ""}">${esc(v)}</td>
              </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${esc(p.title)}</title>
</head>
<body style="margin:0;padding:0;background:#EEF1EF">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EEF1EF">
  <tr>
    <td align="center" style="padding:24px 12px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#FFFFFF">
        <!-- Header -->
        <tr>
          <td style="background:${GREEN};padding:26px 40px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-family:${FONT};color:#FFFFFF;vertical-align:middle">
                  <span style="font-size:24px;font-weight:bold;letter-spacing:.5px">NESR</span>
                  <span style="font-size:12px;letter-spacing:1px;padding-left:6px">TRAINING</span>
                </td>
                <td align="right" style="vertical-align:middle">
                  <span style="display:inline-block;background:${DARK};color:#FFFFFF;font-family:${FONT};font-size:11px;font-weight:bold;letter-spacing:.6px;padding:5px 9px">${esc(p.tag)}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:34px 40px 10px">
            <p style="margin:0 0 6px;font-family:${FONT};font-size:13px;color:#58595B">${esc(p.eyebrow)}</p>
            <h1 style="margin:0 0 20px;font-family:${FONT};font-size:24px;line-height:30px;font-weight:bold;color:${DARK}">${esc(p.title)}</h1>
            ${greets ? "" : `<p style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:22px;color:${DARK}">Dear ${esc(p.firstName)},</p>`}
            ${paragraphs}
          </td>
        </tr>
        <!-- Details -->
        <tr>
          <td style="padding:10px 40px 6px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E1E5E3;border-collapse:collapse">${rows}
            </table>
          </td>
        </tr>
        <!-- Button -->
        <tr>
          <td align="center" style="padding:28px 40px 36px">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background:${GREEN};border-radius:3px">
                  <a href="${esc(p.buttonUrl)}" target="_blank" style="display:inline-block;padding:12px 26px;font-family:${FONT};font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none">${esc(p.buttonText)}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:${DARK};padding:22px 40px">
            <p style="margin:0 0 4px;font-family:${FONT};font-size:13px;font-weight:bold;color:#FFFFFF">National Energy Services Reunited Corp.</p>
            <p style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:#C9CDCB">This is an automated message from the NESR Training Portal. Please do not reply to this email.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
