"use server";

import type { Employee, Prisma } from "@prisma/client";
import { currentEmployee, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { approvalChain, loadSnapshot, type Snapshot } from "@/lib/data";
import { CATEGORIES, LOCATIONS, NATIONALITIES, TYPES } from "@/lib/constants.js";
import { AUDIENCES, audienceIds, fillPlaceholders } from "@/lib/audience.js";
import { dateRange } from "@/lib/training-format.js";
import { trainingEmailHtml } from "@/lib/email-template";
import { headers } from "next/headers";

type Result = { ok: true; data: Snapshot } | { ok: false; error: string };

class UserError extends Error {}

/** Runs a mutation as the signed-in user and returns a fresh snapshot. */
async function run(fn: (me: Employee) => Promise<void>): Promise<Result> {
  const me = await currentEmployee();
  if (!me) return { ok: false, error: "Your session has expired. Sign in again." };
  try {
    await fn(me);
    return { ok: true, data: await loadSnapshot(me.id) };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong saving that change. Try again." };
  }
}

function requireAdmin(me: Employee) {
  if (!me.isAdmin) throw new UserError("Only the L&D team can do that.");
}

const audit = (tx: Prisma.TransactionClient, me: Employee, action: string, entity: string, entityId: string, details?: Prisma.InputJsonValue) =>
  tx.auditLog.create({ data: { actorId: me.id, action, entity, entityId, details } });

const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);

/** Request states that hold a seat in the training (seat is reserved as soon as someone registers). */
const SEAT_STATES = ["pending", "lnd", "enrolled", "completed"];
const holdsSeat = (state: string) => SEAT_STATES.includes(state);

/** Adjusts the training's taken-seat count when a request moves between states. */
async function moveSeat(tx: Prisma.TransactionClient, trainingId: string, from: string, to: string) {
  const delta = Number(holdsSeat(to)) - Number(holdsSeat(from));
  if (delta > 0) await tx.training.update({ where: { id: trainingId }, data: { enrolled: { increment: 1 } } });
  if (delta < 0) await tx.$executeRaw`UPDATE "trainings" SET "enrolled" = GREATEST("enrolled" - 1, 0) WHERE "id" = ${trainingId}`;
}

export async function refresh(): Promise<Result> {
  return run(async () => {});
}

export async function submitRequest(input: { trainingId: string; justification: string; form: Record<string, string> }): Promise<Result> {
  return run(async me => {
    const t = await prisma.training.findFirst({ where: { id: input.trainingId, isActive: true } });
    if (!t) throw new UserError("That session is no longer available.");
    if (await prisma.trainingRequest.findUnique({ where: { employeeId_trainingId: { employeeId: me.id, trainingId: t.id } } }))
      throw new UserError("You already have a request on file for this session.");

    const form = Object.fromEntries(["nesrId", "name", "loc", "dept", "nat", "mgr"].map(k => [k, str(input.form?.[k])]));
    if (!NATIONALITIES.includes(form.nat)) throw new UserError("Choose your nationality.");
    let chain = await approvalChain(me.id);
    // Record who actually approves, not whatever was typed.
    if (chain.length) form.mgr = chain[0].email;

    // No manager known from Entra ID: use the approver email from the form, if it names someone else.
    const mgrEmail = form.mgr.toLowerCase();
    if (!chain.length && mgrEmail && mgrEmail !== me.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mgrEmail)) {
      const local = mgrEmail.split("@")[0].split(/[._-]/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1));
      const approver = await prisma.employee.upsert({
        where: { email: mgrEmail },
        update: {},
        create: { email: mgrEmail, name: local.join(" ") || mgrEmail, firstName: local[0] || mgrEmail }
      });
      chain = [approver];
    }

    await prisma.$transaction(async tx => {
      // Reserve a seat now; only succeeds while seats are left, so two people can't take the last one.
      const reserved = await tx.$executeRaw`UPDATE "trainings" SET "enrolled" = "enrolled" + 1 WHERE "id" = ${t.id} AND "enrolled" < "seats"`;
      const req = await tx.trainingRequest.create({
        data: {
          employeeId: me.id, trainingId: t.id, form, justification: str(input.justification, 2000) || null,
          state: !reserved ? "waitlist" : chain.length ? "pending" : "lnd",
          steps: { create: chain.map((a, i) => ({ stepNo: i, approverId: a.id })) }
        }
      });
      await audit(tx, me, "submit", "request", req.id, { trainingId: t.id, approvers: chain.map(c => c.email) });
    });
  });
}

export async function approveRequest(id: string): Promise<Result> {
  return run(async me => {
    const r = await prisma.trainingRequest.findUnique({ where: { id }, include: { steps: { orderBy: { stepNo: "asc" } } } });
    const step = r?.steps[r.currentStep];
    if (!r || r.state !== "pending" || !step || step.approverId !== me.id) throw new UserError("This request is not waiting on your approval.");
    const done = r.currentStep + 1 >= r.steps.length;
    await prisma.$transaction(async tx => {
      await tx.approvalStep.update({ where: { id: step.id }, data: { status: "approved", decidedAt: new Date() } });
      await tx.trainingRequest.update({ where: { id }, data: done ? { state: "lnd", currentStep: r.currentStep + 1 } : { currentStep: r.currentStep + 1 } });
      await audit(tx, me, "approve", "request", id, { step: r.currentStep });
    });
  });
}

export async function rejectRequest(id: string): Promise<Result> {
  return run(async me => {
    const r = await prisma.trainingRequest.findUnique({ where: { id }, include: { steps: { orderBy: { stepNo: "asc" } } } });
    if (!r) throw new UserError("Request not found.");
    const step = r.steps[r.currentStep];
    const isApprover = r.state === "pending" && step?.approverId === me.id;
    if (!isApprover && !me.isAdmin) throw new UserError("You can't decline this request.");
    if (r.state === "rejected" || r.state === "completed") throw new UserError("This request is already closed.");
    await prisma.$transaction(async tx => {
      if (isApprover) await tx.approvalStep.update({ where: { id: step.id }, data: { status: "rejected", decidedAt: new Date() } });
      await moveSeat(tx, r.trainingId, r.state, "rejected");
      await tx.trainingRequest.update({ where: { id }, data: { state: "rejected" } });
      await audit(tx, me, "reject", "request", id);
    });
  });
}

async function setLndState(id: string, state: "enrolled" | "waitlist"): Promise<Result> {
  return run(async me => {
    requireAdmin(me);
    const r = await prisma.trainingRequest.findUnique({ where: { id } });
    if (!r) throw new UserError("Request not found.");
    if (r.state === state) return;
    await prisma.$transaction(async tx => {
      await moveSeat(tx, r.trainingId, r.state, state);
      await tx.trainingRequest.update({ where: { id }, data: { state } });
      await audit(tx, me, state === "enrolled" ? "enroll" : "waitlist", "request", id);
    });
  });
}
export async function enrollRequest(id: string) { return setLndState(id, "enrolled"); }
export async function waitlistRequest(id: string) { return setLndState(id, "waitlist"); }

export async function saveTraining(ed: Record<string, unknown>): Promise<Result> {
  return run(async me => {
    requireAdmin(me);
    const start = str(ed.start, 10), end = str(ed.end, 10);
    const dateOk = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
    const seats = Math.floor(Number(ed.seats));
    const missing = [
      !str(ed.code) && "session code", !str(ed.instructor) && "instructor", !str(ed.title) && "training title",
      !CATEGORIES.includes(String(ed.category)) && "category", !TYPES.includes(String(ed.type)) && "type",
      !dateOk(start) && "start date", !dateOk(end) && "end date",
      !LOCATIONS.includes(String(ed.location)) && "location", !(seats >= 1) && "seat capacity", !str(ed.desc) && "description"
    ].filter(Boolean);
    if (missing.length) throw new UserError("Please fill in: " + missing.join(", ") + ".");
    if (end < start) throw new UserError("End date must be on or after the start date.");
    const data = {
      code: str(ed.code, 20), title: str(ed.title), instructor: str(ed.instructor),
      category: String(ed.category), type: String(ed.type), location: String(ed.location),
      startDate: new Date(start), endDate: new Date(end), seats,
      description: str(ed.desc, 4000)
    };
    await prisma.$transaction(async tx => {
      const id = ed.id ? String(ed.id) : null;
      const t = id ? await tx.training.update({ where: { id }, data }) : await tx.training.create({ data });
      await audit(tx, me, id ? "update" : "create", "training", t.id, { code: t.code });
    });
  });
}

export async function deleteTraining(id: string): Promise<Result> {
  return run(async me => {
    requireAdmin(me);
    await prisma.$transaction(async tx => {
      await tx.training.update({ where: { id }, data: { isActive: false } });
      await audit(tx, me, "withdraw", "training", id);
    });
  });
}

/** Marks attendance. Attended → the request becomes "completed"; no show → back to "enrolled". */
export async function setAttendance(trainingId: string, employeeId: string, attended: boolean): Promise<Result> {
  return run(async me => {
    requireAdmin(me);
    await prisma.$transaction(async tx => {
      await tx.attendance.upsert({
        where: { trainingId_employeeId: { trainingId, employeeId } },
        update: { attended, markedById: me.id },
        create: { trainingId, employeeId, attended, markedById: me.id }
      });
      await tx.trainingRequest.updateMany({
        where: { trainingId, employeeId, state: { in: attended ? ["enrolled"] : ["completed"] } },
        data: { state: attended ? "completed" : "enrolled" }
      });
      await audit(tx, me, attended ? "attended" : "no_show", "attendance", `${trainingId}:${employeeId}`);
    });
  });
}

export async function setTemplateActive(id: string, isActive: boolean): Promise<Result> {
  return run(async me => {
    requireAdmin(me);
    await prisma.notificationTemplate.update({ where: { id }, data: { isActive } });
  });
}

export async function saveTemplate(input: { id: string; name: string; trigger: string; subject: string; body: string }): Promise<Result> {
  return run(async me => {
    requireAdmin(me);
    const name = str(input.name, 120), subject = str(input.subject, 300), body = String(input.body ?? "").trim().slice(0, 10000);
    if (!name || !subject || !body) throw new UserError("Name, subject and message are all required.");
    await prisma.$transaction(async tx => {
      await tx.notificationTemplate.update({ where: { id: String(input.id) }, data: { name, trigger: str(input.trigger, 200), subject, body } });
      await audit(tx, me, "update", "template", String(input.id));
    });
  });
}


/**
 * Emails everyone in the chosen audience of a training, personalised per person, via the n8n webhook.
 * Recipients are resolved here on the server and never sent to the browser.
 */
/** Public address of the portal, for links in emails. */
async function portalUrl() {
  if (process.env.LD_PUBLIC_URL) return process.env.LD_PUBLIC_URL.replace(/[/]+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const proto = h.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function sendTrainingEmail(input: { trainingId: string; audience: string; subject: string; body: string; templateId?: string }): Promise<Result & { sent?: number }> {
  let sent = 0;
  const result = await run(async me => {
    requireAdmin(me);
    // Sender: the Outlook account connected in n8n. LD_MAIL_FROM is optional and only passed along as information.
    const from = process.env.LD_MAIL_FROM || null, hook = process.env.LD_N8N_EMAIL_WEBHOOK_URL;
    if (!hook) throw new UserError("Email sending isn't set up yet: LD_N8N_EMAIL_WEBHOOK_URL must be set in Vercel.");
    const audience = AUDIENCES.some(a => a.value === input.audience) ? input.audience : "registered";
    const subject = str(input.subject, 300), body = String(input.body ?? "").trim().slice(0, 10000);
    if (!subject || !body) throw new UserError("Write a subject and a message first.");

    const t = await prisma.training.findUnique({ where: { id: String(input.trainingId) } });
    if (!t) throw new UserError("Choose a training.");
    const [requests, attendance] = await Promise.all([
      prisma.trainingRequest.findMany({ where: { trainingId: t.id }, select: { employeeId: true, state: true } }),
      prisma.attendance.findMany({ where: { trainingId: t.id } })
    ]);
    const ids = audienceIds(audience, t.id,
      requests.map(r => ({ who: r.employeeId, tid: t.id, state: r.state })),
      Object.fromEntries(attendance.map(a => [`${t.id}:${a.employeeId}`, a.attended])));
    if (!ids.length) throw new UserError("No one in that group for this training.");

    const people = await prisma.employee.findMany({ where: { id: { in: ids } }, include: { manager: true } });
    const template = input.templateId ? await prisma.notificationTemplate.findUnique({ where: { id: String(input.templateId) } }) : null;
    const tag = (template?.name || "Training Update").toUpperCase();
    const link = await portalUrl();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const shared = { training_title: t.title, session_code: t.code, dates: dateRange(iso(t.startDate), iso(t.endDate)), location: t.location };
    const messages = people.map(p => {
      const values = { ...shared, first_name: p.firstName, employee_name: p.name, manager_name: p.manager?.name || "your manager" };
      const text = fillPlaceholders(body, values);
      const filledSubject = fillPlaceholders(subject, values);
      // Test mode: everything goes to one inbox; the subject shows who it was meant for.
      const testTo = (process.env.LD_MAIL_TEST_RECIPIENT || "").trim();
      const html = trainingEmailHtml({
        tag, eyebrow: `${t.code} · NESR Training Portal`, title: filledSubject, firstName: p.firstName, message: text,
        details: [["Session", t.code], ["Training", t.title], ["Dates", shared.dates], ["Location", t.location]],
        buttonText: "Open Training Portal", buttonUrl: link
      });
      return { to: testTo || p.email, intendedTo: p.email, name: p.name,
        subject: testTo ? `[TEST → ${p.email}] ${filledSubject}` : filledSubject, text, html };
    });

    const res = await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(process.env.LD_N8N_EMAIL_WEBHOOK_SECRET ? { "x-webhook-secret": process.env.LD_N8N_EMAIL_WEBHOOK_SECRET } : {}) },
      body: JSON.stringify({ from, testMode: !!process.env.LD_MAIL_TEST_RECIPIENT, training: { id: t.id, ...shared }, audience, count: messages.length, messages })
    }).catch(() => null);
    if (!res || !res.ok) throw new UserError(`The email service didn't accept the request${res ? ` (HTTP ${res.status})` : ""}. Nothing was sent.`);

    sent = messages.length;
    await prisma.auditLog.create({ data: { actorId: me.id, action: "email", entity: "training", entityId: t.id, details: { audience, count: sent, subject } } });
  });
  return result.ok ? { ...result, sent } : result;
}

export async function logout() {
  await signOut({ redirectTo: "/login" });
}
