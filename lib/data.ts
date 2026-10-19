import "server-only";
import type { Employee } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { APPROVAL_LEVELS } from "@/lib/constants.js";

const SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const pretty = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")} ${SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

export type Person = {
  key: string; name: string; first: string; nesrId: string; title: string; dept: string; loc: string;
  email: string; boss: string | null; admin: boolean;
};

export const toPerson = (e: Employee): Person => ({
  key: e.id, name: e.name, first: e.firstName, nesrId: e.nesrId || "—", title: e.title || "",
  dept: e.department || "", loc: e.location || "", email: e.email, boss: e.managerId, admin: e.isAdmin
});

/** Managers above `employeeId`, nearest first, up to APPROVAL_LEVELS. */
export async function approvalChain(employeeId: string): Promise<Employee[]> {
  const out: Employee[] = [];
  let cur = await prisma.employee.findUnique({ where: { id: employeeId } });
  while (cur?.managerId && out.length < APPROVAL_LEVELS) {
    const boss = await prisma.employee.findUnique({ where: { id: cur.managerId } });
    if (!boss || out.some(b => b.id === boss.id) || boss.id === employeeId) break;
    out.push(boss);
    cur = boss;
  }
  return out;
}

/** Everything the portal UI needs for one signed-in person, filtered to what they may see. */
export async function loadSnapshot(meId: string) {
  const me = await prisma.employee.findUniqueOrThrow({ where: { id: meId } });

  const [trainings, requests, reports, chain, templates] = await Promise.all([
    prisma.training.findMany({ where: { isActive: true }, orderBy: { startDate: "asc" } }),
    prisma.trainingRequest.findMany({
      // Non-admins: their own requests, requests they approve, and all requests from their direct reports.
      where: me.isAdmin ? {} : {
        OR: [{ employeeId: me.id }, { steps: { some: { approverId: me.id } } }, { employee: { managerId: me.id } }]
      },
      include: { steps: { orderBy: { stepNo: "asc" } } },
      orderBy: { submittedAt: "desc" }
    }),
    prisma.employee.findMany({ where: { managerId: me.id } }),
    approvalChain(me.id),
    me.isAdmin ? prisma.notificationTemplate.findMany() : Promise.resolve([])
  ]);

  // Admins see all attendance; others only for people whose requests they can see (themselves, their team).
  const requesters = [...new Set(requests.map(r => r.employeeId))];
  const attendance = await prisma.attendance.findMany({ where: me.isAdmin ? {} : { employeeId: { in: requesters } } });

  const ids = new Set<string>([me.id, ...reports.map(r => r.id), ...chain.map(c => c.id)]);
  requests.forEach(r => { ids.add(r.employeeId); r.steps.forEach(s => ids.add(s.approverId)); });
  const people = await prisma.employee.findMany({ where: { id: { in: [...ids] } } });

  const isApprover = requests.some(r => r.steps.some(s => s.approverId === me.id));

  return {
    meId: me.id,
    isAdmin: me.isAdmin,
    canManage: reports.length > 0 || isApprover,
    people: Object.fromEntries(people.map(p => [p.id, toPerson(p)])),
    trainings: trainings.map(t => ({
      id: t.id, code: t.code, title: t.title, category: t.category, type: t.type,
      start: iso(t.startDate), end: iso(t.endDate), location: t.location,
      seats: t.seats, enrolled: t.enrolled, instructor: t.instructor || "", desc: t.description || ""
    })),
    requests: requests.map(r => ({
      id: r.id, who: r.employeeId, tid: r.trainingId,
      chain: r.steps.map(s => s.approverId), step: r.currentStep, state: r.state,
      submitted: pretty(r.submittedAt), submittedAt: r.submittedAt.toISOString(),
      justification: r.justification || "—", form: r.form
    })),
    attended: Object.fromEntries(attendance.map(a => [`${a.trainingId}:${a.employeeId}`, a.attended])),
    templatesOff: Object.fromEntries(templates.filter(t => !t.isActive).map(t => [t.id, true])),
    templates: templates.map(t => ({ id: t.id, name: t.name, trigger: t.trigger, subject: t.subject, body: t.body })),
    mail: me.isAdmin
      ? {
          from: process.env.LD_MAIL_FROM || "",
          configured: !!(process.env.LD_MAIL_FROM && process.env.LD_N8N_EMAIL_WEBHOOK_URL),
          testRecipient: (process.env.LD_MAIL_TEST_RECIPIENT || "").trim()
        }
      : null
  };
}

export type Snapshot = Awaited<ReturnType<typeof loadSnapshot>>;
