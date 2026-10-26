import "server-only";
import { headers } from "next/headers";
import type { Employee, Training } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fillPlaceholders } from "@/lib/audience.js";
import { dateRange } from "@/lib/training-format.js";
import { trainingEmailHtml } from "@/lib/email-template";

// Builds personalised emails from a template and hands them to the n8n webhook.
// Used by the automatic notifications and by Notifications → Send Training Email.

/** Public address of the portal, for links in emails. */
export async function portalUrl() {
  if (process.env.LD_PUBLIC_URL) return process.env.LD_PUBLIC_URL.replace(/[/]+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const proto = h.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function trainingValues(t: Training) {
  return { training_title: t.title, session_code: t.code, dates: dateRange(iso(t.startDate), iso(t.endDate)), location: t.location };
}

export type Recipient = {
  to: Pick<Employee, "email" | "name" | "firstName">;
  employeeName?: string;   // the person the email is about ({{employee_name}}), defaults to the recipient
  managerName?: string;    // their approver / manager ({{manager_name}})
  comment?: string | null; // decline reason ({{comment}})
};

type Message = { to: string; intendedTo: string; name: string; subject: string; text: string; html: string };

/** One personalised message. */
export function buildMessage(t: Training, tag: string, subject: string, body: string, r: Recipient, link: string): Message {
  const shared = trainingValues(t);
  const values = {
    ...shared,
    first_name: r.to.firstName, recipient_name: r.to.name,
    employee_name: r.employeeName || r.to.name,
    manager_name: r.managerName || "your manager",
    comment: r.comment || ""
  };
  let text = fillPlaceholders(body, values);
  // Templates that don't mention {{comment}} still get the decline reason
  if (r.comment && !body.includes("{{comment}}")) text += `\n\nComment from ${r.managerName || "the approver"}: ${r.comment}`;
  const filledSubject = fillPlaceholders(subject, values);
  const testTo = (process.env.LD_MAIL_TEST_RECIPIENT || "").trim();
  const html = trainingEmailHtml({
    tag: tag.toUpperCase(), eyebrow: `${t.code} · NESR Training Portal`, title: filledSubject, firstName: r.to.firstName, message: text,
    details: [["Session", t.code], ["Training", t.title], ["Dates", shared.dates], ["Location", t.location]],
    buttonText: "Open Training Portal", buttonUrl: link
  });
  return {
    to: testTo || r.to.email, intendedTo: r.to.email, name: r.to.name,
    subject: testTo ? `[TEST → ${r.to.email}] ${filledSubject}` : filledSubject, text, html
  };
}

/** Posts messages to n8n. Throws on failure (callers decide whether that matters). */
export async function postToN8n(t: Training, audience: string, messages: Message[]) {
  const hook = process.env.LD_N8N_EMAIL_WEBHOOK_URL;
  if (!hook) throw new Error("LD_N8N_EMAIL_WEBHOOK_URL is not set");
  const res = await fetch(hook, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(process.env.LD_N8N_EMAIL_WEBHOOK_SECRET ? { "x-webhook-secret": process.env.LD_N8N_EMAIL_WEBHOOK_SECRET } : {}) },
    body: JSON.stringify({
      from: process.env.LD_MAIL_FROM || null, testMode: !!process.env.LD_MAIL_TEST_RECIPIENT,
      training: { id: t.id, ...trainingValues(t) }, audience, count: messages.length, messages
    }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!res.ok) throw new Error(`n8n answered HTTP ${res.status}`);
}

/**
 * Automatic email from a template. Never throws: the portal action has already been saved,
 * so a mail problem is logged instead of undoing it. Skipped if the template is paused.
 */
export async function notify(templateId: string, training: Training, recipients: Recipient[], actorId?: string) {
  const list = recipients.filter(r => r.to?.email);
  if (!list.length) return;
  try {
    const tpl = await prisma.notificationTemplate.findUnique({ where: { id: templateId } });
    if (!tpl) return console.warn(`[email] template "${templateId}" not found; nothing sent`);
    if (!tpl.isActive) return console.info(`[email] template "${templateId}" is paused; nothing sent`);
    if (!process.env.LD_N8N_EMAIL_WEBHOOK_URL) return console.info(`[email] n8n webhook not set; "${templateId}" not sent`);
    const link = await portalUrl();
    const messages = list.map(r => buildMessage(training, tpl.name, tpl.subject, tpl.body, r, link));
    await postToN8n(training, `auto:${templateId}`, messages);
    await prisma.auditLog.create({ data: { actorId: actorId || null, action: "email_auto", entity: "training", entityId: training.id, details: { template: templateId, count: messages.length } } });
    console.info(`[email] "${templateId}" sent to ${messages.length}`);
  } catch (e) {
    console.warn(`[email] "${templateId}" failed: ${(e as Error).message}`);
  }
}
