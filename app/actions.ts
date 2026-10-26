"use server";

import type { Employee, Prisma } from "@prisma/client";
import { currentEmployee, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { approvalChain, loadSnapshot, type Snapshot } from "@/lib/data";
import { CATEGORIES, LOCATIONS, NATIONALITIES, TYPES } from "@/lib/constants.js";
import { AUDIENCES, audienceIds } from "@/lib/audience.js";
import { buildMessage, notify, portalUrl, postToN8n } from "@/lib/notify";
import { ensureManager } from "@/lib/graph";

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

/** Request states that hold a seat. A seat is taken when the manager approves (or L&D enrolls), not on request. */
const SEAT_STATES = ["enrolled", "completed"];
const holdsSeat = (state: string) => SEAT_STATES.includes(state);

/** Takes a seat if registration is open and one is left. Atomic, so two approvals can't take the last seat. */
async function takeSeat(tx: Prisma.TransactionClient, trainingId: string) {
  const n = await tx.$executeRaw`UPDATE "trainings" SET "enrolled" = "enrolled" + 1
    WHERE "id" = ${trainingId} AND "enrolled" < "seats" AND "registration_open" = true`;
  return n > 0;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Finds an employee by email, or creates a placeholder that is completed when they first sign in. */
async function employeeByEmail(email: string) {
  const local = email.split("@")[0].split(/[._-]/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1));
  return prisma.employee.upsert({
    where: { email },
    update: {},
    create: { email, name: local.join(" ") || email, firstName: local[0] || email }
  });
}

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
    if (!t.registrationOpen) throw new UserError("Registration for this session is closed.");
    if (await prisma.trainingRequest.findUnique({ where: { employeeId_trainingId: { employeeId: me.id, trainingId: t.id } } }))
      throw new UserError("You already have a request on file for this session.");

    const form = Object.fromEntries(["nesrId", "name", "loc", "dept", "nat", "mgr"].map(k => [k, str(input.form?.[k])]));
    const justification = str(input.justification, 2000);
    await ensureManager(me); // fills in the line manager from Entra ID if sign-in couldn't
    let chain = await approvalChain(me.id);
    // Record who actually approves, not whatever was typed.
    if (chain.length) form.mgr = chain[0].email;
    const missing = [!form.nesrId && "NESR ID", !form.name && "full name", !form.loc && "work location", !form.dept && "department",
      !NATIONALITIES.includes(form.nat) && "nationality", !chain.length && !EMAIL_RE.test(form.mgr) && "approver email",
      !justification && "business justification"].filter(Boolean);
    if (missing.length) throw new UserError("Please fill in: " + missing.join(", ") + ".");

    // No manager known from Entra ID: the approver email from the form becomes the approver.
    const mgrEmail = form.mgr.toLowerCase();
    if (!chain.length) {
      if (mgrEmail === me.email) throw new UserError("You can't approve your own request. Enter your line manager's email.");
      chain = [await employeeByEmail(mgrEmail)];
    }

    await prisma.$transaction(async tx => {
      const req = await tx.trainingRequest.create({
        data: {
          employeeId: me.id, trainingId: t.id, form, justification,
          state: "pending",
          steps: { create: chain.map((a, i) => ({ stepNo: i, approverId: a.id })) }
        }
      });
      await audit(tx, me, "submit", "request", req.id, { trainingId: t.id, approvers: chain.map(c => c.email) });
    });
    // Automatic emails: confirmation to the employee, action request to the manager
    await notify("submitted", t, [{ to: me, managerName: chain[0].name }], me.id);
    await notify("manager", t, [{ to: chain[0], employeeName: me.name, managerName: chain[0].name }], me.id);
  });
}

/** Name of whoever approves (or approved) a request: the last approver in its chain, else the employee's manager. */
async function approverNameFor(requestId: string) {
  const r = await prisma.trainingRequest.findUnique({
    where: { id: requestId },
    include: { steps: { orderBy: { stepNo: "desc" }, take: 1, include: { approver: true } }, employee: { include: { manager: true } } }
  });
  return r?.steps[0]?.approver.name || r?.employee.manager?.name || "your manager";
}

export async function approveRequest(id: string): Promise<Result> {
  return run(async me => {
    const r = await prisma.trainingRequest.findUnique({ where: { id }, include: { steps: { orderBy: { stepNo: "asc" } } } });
    const step = r?.steps[r.currentStep];
    if (!r || r.state !== "pending" || !step || step.approverId !== me.id) throw new UserError("This request is not waiting on your approval.");
    const done = r.currentStep + 1 >= r.steps.length;
    let outcome: "enrolled" | "waitlist" | null = null;
    await prisma.$transaction(async tx => {
      await tx.approvalStep.update({ where: { id: step.id }, data: { status: "approved", decidedAt: new Date() } });
      if (!done) {
        await tx.trainingRequest.update({ where: { id }, data: { currentStep: r.currentStep + 1 } });
        await audit(tx, me, "approve", "request", id, { step: r.currentStep });
        return;
      }
      // Final approval: enrolled if registration is open and a seat is left, otherwise waitlisted.
      const seated = await takeSeat(tx, r.trainingId);
      outcome = seated ? "enrolled" : "waitlist";
      await tx.trainingRequest.update({ where: { id }, data: { state: outcome, currentStep: r.currentStep + 1 } });
      await audit(tx, me, "approve", "request", id, { step: r.currentStep, outcome });
    });
    if (outcome) {
      const full = await prisma.trainingRequest.findUnique({ where: { id }, include: { employee: true, training: true } });
      if (full) await notify(outcome === "enrolled" ? "enrolled" : "waitlisted", full.training, [{ to: full.employee, managerName: me.name }], me.id);
    }
  });
}

/** Declines a request. The manager must give a reason; L&D may. The reason goes to the employee. */
export async function rejectRequest(id: string, comment?: string): Promise<Result> {
  return run(async me => {
    const r = await prisma.trainingRequest.findUnique({ where: { id }, include: { steps: { orderBy: { stepNo: "asc" } } } });
    if (!r) throw new UserError("Request not found.");
    const step = r.steps[r.currentStep];
    const isApprover = r.state === "pending" && step?.approverId === me.id;
    if (!isApprover && !me.isAdmin) throw new UserError("You can't decline this request.");
    if (r.state === "rejected" || r.state === "completed") throw new UserError("This request is already closed.");
    const reason = str(comment, 2000);
    if (isApprover && reason.length < 3) throw new UserError("Please add a short reason for declining.");
    await prisma.$transaction(async tx => {
      if (isApprover) await tx.approvalStep.update({ where: { id: step.id }, data: { status: "rejected", decidedAt: new Date(), comment: reason || null } });
      await moveSeat(tx, r.trainingId, r.state, "rejected");
      await tx.trainingRequest.update({ where: { id }, data: { state: "rejected", decisionComment: reason || null } });
      await audit(tx, me, "reject", "request", id, reason ? { comment: reason } : undefined);
    });
    const full = await prisma.trainingRequest.findUnique({ where: { id }, include: { employee: true, training: true } });
    if (full) await notify("declined", full.training, [{ to: full.employee, managerName: isApprover ? me.name : "the L&D team", comment: reason || null }], me.id);
  });
}

/** L&D enrolls someone from the waitlist. L&D may go over capacity or enroll after registration closed. */
export async function enrollRequest(id: string): Promise<Result> {
  return run(async me => {
    requireAdmin(me);
    const r = await prisma.trainingRequest.findUnique({ where: { id } });
    if (!r) throw new UserError("Request not found.");
    if (r.state === "enrolled" || r.state === "completed") return;
    await prisma.$transaction(async tx => {
      await moveSeat(tx, r.trainingId, r.state, "enrolled");
      await tx.trainingRequest.update({ where: { id }, data: { state: "enrolled" } });
      await audit(tx, me, "enroll", "request", id, { from: r.state });
    });
    const full = await prisma.trainingRequest.findUnique({ where: { id }, include: { employee: true, training: true } });
    if (full) await notify("enrolled", full.training, [{ to: full.employee, managerName: await approverNameFor(id) }], me.id);
  });
}

/** L&D adds a person straight into a training (enrolled), by employee id or email. */
export async function addParticipant(trainingId: string, who: string): Promise<Result> {
  return run(async me => {
    requireAdmin(me);
    const t = await prisma.training.findFirst({ where: { id: trainingId, isActive: true } });
    if (!t) throw new UserError("Training not found.");
    const key = str(who, 200).toLowerCase();
    if (!key) throw new UserError("Choose a person or type their email.");
    // Accept "Name <email>" from the picker, a bare email, or an employee id
    const email = (key.match(/<([^>]+)>/)?.[1] || key).trim();
    const person = EMAIL_RE.test(email)
      ? await employeeByEmail(email)
      : await prisma.employee.findUnique({ where: { id: str(who, 64) } });
    if (!person) throw new UserError("No one found with that email.");

    const existing = await prisma.trainingRequest.findUnique({ where: { employeeId_trainingId: { employeeId: person.id, trainingId } } });
    if (existing && holdsSeat(existing.state)) throw new UserError(person.name + " is already enrolled.");
    await prisma.$transaction(async tx => {
      await tx.training.update({ where: { id: trainingId }, data: { enrolled: { increment: 1 } } });
      const form = { nesrId: person.nesrId || "", name: person.name, loc: person.location || "", dept: person.department || "", nat: "", mgr: "" };
      const req = existing
        ? await tx.trainingRequest.update({ where: { id: existing.id }, data: { state: "enrolled" } })
        : await tx.trainingRequest.create({ data: { employeeId: person.id, trainingId, state: "enrolled", form, justification: "Added by the L&D team" } });
      await audit(tx, me, "add_participant", "request", req.id, { trainingId, email: person.email, from: existing?.state ?? null });
    });
    await notify("enrolled", t, [{ to: person, managerName: "the L&D team" }], me.id);
  });
}

/** L&D removes someone's registration entirely (any status). The seat is released; the audit log keeps the record. */
export async function removeParticipant(requestId: string): Promise<Result> {
  return run(async me => {
    requireAdmin(me);
    const r = await prisma.trainingRequest.findUnique({ where: { id: requestId }, include: { employee: true } });
    if (!r) throw new UserError("Registration not found.");
    await prisma.$transaction(async tx => {
      if (holdsSeat(r.state)) await tx.$executeRaw`UPDATE "trainings" SET "enrolled" = GREATEST("enrolled" - 1, 0) WHERE "id" = ${r.trainingId}`;
      await tx.attendance.deleteMany({ where: { trainingId: r.trainingId, employeeId: r.employeeId } });
      await tx.trainingRequest.delete({ where: { id: requestId } });
      await audit(tx, me, "remove_participant", "request", requestId, { trainingId: r.trainingId, email: r.employee.email, state: r.state });
    });
  });
}

/** Opens or closes registration for a training. */
export async function setRegistrationOpen(trainingId: string, open: boolean): Promise<Result> {
  return run(async me => {
    requireAdmin(me);
    await prisma.$transaction(async tx => {
      await tx.training.update({ where: { id: trainingId }, data: { registrationOpen: open } });
      await audit(tx, me, open ? "registration_open" : "registration_close", "training", trainingId);
    });
  });
}

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
      description: str(ed.desc, 4000),
      registrationOpen: ed.registration !== "Closed"
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
    const t = await prisma.training.findUnique({ where: { id } });
    if (!t) throw new UserError("Training not found.");
    // Everyone still registered (not declined, not already completed) is told it's cancelled
    const registered = await prisma.trainingRequest.findMany({
      where: { trainingId: id, state: { in: ["pending", "enrolled", "waitlist"] } }, include: { employee: true }
    });
    await prisma.$transaction(async tx => {
      await tx.training.update({ where: { id }, data: { isActive: false } });
      await audit(tx, me, "withdraw", "training", id, { notified: registered.length });
    });
    await notify("cancelled", t, registered.map(r => ({ to: r.employee })), me.id);
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
export async function sendTrainingEmail(input: { trainingId: string; audience: string; subject: string; body: string; templateId?: string }): Promise<Result & { sent?: number }> {
  let sent = 0;
  const result = await run(async me => {
    requireAdmin(me);
    if (!process.env.LD_N8N_EMAIL_WEBHOOK_URL) throw new UserError("Email sending isn't set up yet: LD_N8N_EMAIL_WEBHOOK_URL must be set in Vercel.");
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
    const link = await portalUrl();
    const messages = people.map(p => buildMessage(t, template?.name || "Training Update", subject, body,
      { to: p, managerName: p.manager?.name || "your manager" }, link));
    try {
      await postToN8n(t, audience, messages);
    } catch (e) {
      throw new UserError(`The email service didn't accept the request (${(e as Error).message}). Nothing was sent.`);
    }
    sent = messages.length;
    await prisma.auditLog.create({ data: { actorId: me.id, action: "email", entity: "training", entityId: t.id, details: { audience, count: sent, subject } } });
  });
  return result.ok ? { ...result, sent } : result;
}

export async function logout() {
  await signOut({ redirectTo: "/login" });
}
