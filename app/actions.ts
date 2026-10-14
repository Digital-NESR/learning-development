"use server";

import type { Employee, Prisma } from "@prisma/client";
import { currentEmployee, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { approvalChain, loadSnapshot, type Snapshot } from "@/lib/data";
import { CATEGORIES, LOCATIONS, TYPES } from "@/lib/constants.js";

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
    let chain = await approvalChain(me.id);

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

    const full = t.enrolled >= t.seats;
    await prisma.$transaction(async tx => {
      const req = await tx.trainingRequest.create({
        data: {
          employeeId: me.id, trainingId: t.id, form, justification: str(input.justification, 2000) || null,
          state: full ? "waitlist" : chain.length ? "pending" : "lnd",
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
      if (r.state === "enrolled") await tx.training.update({ where: { id: r.trainingId }, data: { enrolled: { decrement: 1 } } });
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
      if (state === "enrolled") await tx.training.update({ where: { id: r.trainingId }, data: { enrolled: { increment: 1 } } });
      if (r.state === "enrolled") await tx.training.update({ where: { id: r.trainingId }, data: { enrolled: { decrement: 1 } } });
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
    if (!str(ed.code) || !str(ed.title)) throw new UserError("Session code and title are required.");
    if (!dateOk(start) || !dateOk(end)) throw new UserError("Enter start and end dates as YYYY-MM-DD.");
    if (end < start) throw new UserError("End date must be on or after the start date.");
    const seats = Math.max(0, Math.floor(Number(ed.seats) || 0));
    if (!seats) throw new UserError("Seat capacity must be at least 1.");
    const data = {
      code: str(ed.code, 20), title: str(ed.title), instructor: str(ed.instructor) || null,
      category: CATEGORIES.includes(String(ed.category)) ? String(ed.category) : CATEGORIES[0],
      type: TYPES.includes(String(ed.type)) ? String(ed.type) : TYPES[0],
      location: LOCATIONS.includes(String(ed.location)) ? String(ed.location) : LOCATIONS[0],
      startDate: new Date(start), endDate: new Date(end), seats,
      description: str(ed.desc, 4000) || "Session details to be published by the L&D team."
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

export async function setAttendance(trainingId: string, employeeId: string, attended: boolean): Promise<Result> {
  return run(async me => {
    requireAdmin(me);
    await prisma.attendance.upsert({
      where: { trainingId_employeeId: { trainingId, employeeId } },
      update: { attended, markedById: me.id },
      create: { trainingId, employeeId, attended, markedById: me.id }
    });
  });
}

export async function setTemplateActive(id: string, isActive: boolean): Promise<Result> {
  return run(async me => {
    requireAdmin(me);
    await prisma.notificationTemplate.update({ where: { id }, data: { isActive } });
  });
}

export async function logout() {
  await signOut({ redirectTo: "/login" });
}
