import "server-only";
import type { Employee } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { APPROVAL_LEVELS } from "@/lib/constants.js";
import { normId, nameKey, nameWords } from "@/lib/history";

const SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const pretty = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")} ${SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

export type Person = {
  key: string; name: string; first: string; nesrId: string; title: string; dept: string; loc: string;
  email: string; boss: string | null; admin: boolean; external: boolean; org: string;
};

export const toPerson = (e: Employee): Person => ({
  key: e.id, name: e.name, first: e.firstName, nesrId: e.nesrId || "—", title: e.title || "",
  dept: e.department || "", loc: e.location || "", email: e.email, boss: e.managerId, admin: e.isAdmin,
  external: e.isExternal, org: e.organization || ""
});

/** Managers above `employeeId`, nearest first, up to APPROVAL_LEVELS. */
export async function approvalChain(employeeId: string, self?: Employee): Promise<Employee[]> {
  const out: Employee[] = [];
  let cur = self ?? await prisma.employee.findUnique({ where: { id: employeeId } });
  while (cur?.managerId && out.length < APPROVAL_LEVELS) {
    const boss = await prisma.employee.findUnique({ where: { id: cur.managerId } });
    if (!boss || out.some(b => b.id === boss.id) || boss.id === employeeId) break;
    out.push(boss);
    cur = boss;
  }
  return out;
}

/** Everything the portal UI needs for one signed-in person, filtered to what they may see. */
export async function loadSnapshot(meOrId: string | Employee) {
  const me = typeof meOrId === "string" ? await prisma.employee.findUniqueOrThrow({ where: { id: meOrId } }) : meOrId;

  // Everything that doesn't depend on another query is fetched at once: each round trip to the database adds latency.
  const [trainings, requests, reports, chain, templates, adminAttendance, attendanceDays, surveyResponses, directory, instructors] = await Promise.all([
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
    approvalChain(me.id, me),
    me.isAdmin ? prisma.notificationTemplate.findMany() : Promise.resolve([]),
    // L&D only: all attendance, per-day attendance, survey response counts and the "Add person" directory
    me.isAdmin ? prisma.attendance.findMany() : Promise.resolve(null),
    me.isAdmin ? prisma.attendanceDay.findMany() : Promise.resolve([]),
    me.isAdmin ? prisma.surveyResponse.findMany({ select: { trainingId: true, employeeId: true, createdAt: true } }) : Promise.resolve([]),
    me.isAdmin
      ? prisma.employee.findMany({ where: { isExternal: false }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    // Instructor profiles for Resources (the documents themselves are fetched from /api/instructors)
    prisma.instructorProfile.findMany({ select: { id: true, name: true, title: true, bio: true, link: true, fileName: true }, orderBy: { name: "asc" } })
  ]);

  const days: Record<string, Record<string, boolean>> = {};
  for (const d of attendanceDays) (days[`${d.trainingId}:${d.employeeId}`] ||= {})[iso(d.day)] = d.present;

  const ids = new Set<string>([me.id, ...reports.map(r => r.id), ...chain.map(c => c.id)]);
  requests.forEach(r => { ids.add(r.employeeId); r.steps.forEach(s => ids.add(s.approverId)); });
  // Non-admins see attendance only for people whose requests they can see (themselves, their team).
  const requesters = [...new Set(requests.map(r => r.employeeId))];
  const [people, attendance] = await Promise.all([
    prisma.employee.findMany({ where: { id: { in: [...ids] } } }),
    adminAttendance ?? prisma.attendance.findMany({ where: { employeeId: { in: requesters } } })
  ]);

  const isApprover = requests.some(r => r.steps.some(s => s.approverId === me.id));

  // Completed trainings from before the portal: for me, my direct reports and anyone whose request I approve.
  const historyFor = new Map<string, Employee>();
  for (const p of people) {
    if (p.id === me.id || p.managerId === me.id || requests.some(r => r.employeeId === p.id && r.steps.some(s => s.approverId === me.id))) historyFor.set(p.id, p);
  }
  const idsOf = new Map<string, Set<string>>();
  for (const p of historyFor.values()) {
    const set = new Set<string>();
    const own = normId(p.nesrId); if (own) set.add(own);
    // The NESR ID typed on the registration form, for accounts where Entra has none
    for (const r of requests) if (r.employeeId === p.id) { const f = normId((r.form as Record<string, unknown> | null)?.nesrId); if (f) set.add(f); }
    idsOf.set(p.id, set);
  }
  const allIds = [...new Set([...idsOf.values()].flatMap(s => [...s]))];
  const allNames = [...historyFor.values()].map(p => nameKey(p.name));
  const [historyRows, historyStats] = await Promise.all([
    historyFor.size
      ? prisma.trainingHistory.findMany({
          where: { OR: [{ nesrId: { in: allIds } }, { nesrId: null, nameKey: { in: allNames } }] },
          select: { nesrId: true, nameKey: true, title: true, year: true }
        })
      : Promise.resolve([]),
    me.isAdmin
      ? prisma.$queryRaw<{ records: number; people: number; first: number | null; last: number | null; at: Date | null }[]>`
          SELECT COUNT(*)::int AS records, COUNT(DISTINCT COALESCE(nesr_id, 'n:' || name_key))::int AS people,
                 MIN(year) AS first, MAX(year) AS last, MAX(imported_at) AS at FROM training_history`
      : Promise.resolve(null)
  ]);
  const history: Record<string, { title: string; year: number | null }[]> = {};
  for (const p of historyFor.values()) {
    const ids = idsOf.get(p.id)!, nk = nameKey(p.name), words = nameWords(p.name);
    // An ID match also needs a name in common, so a mistyped ID (or a demo account) never shows someone else's record
    history[p.id] = historyRows
      .filter(h => h.nesrId ? ids.has(h.nesrId) && nameWords(h.nameKey).some(w => words.includes(w)) : h.nameKey === nk)
      .map(h => ({ title: h.title, year: h.year }))
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title));
  }
  const hs = historyStats?.[0];

  return {
    meId: me.id,
    isAdmin: me.isAdmin,
    canManage: reports.length > 0 || isApprover,
    people: Object.fromEntries(people.map(p => [p.id, toPerson(p)])),
    trainings: trainings.map(t => ({
      id: t.id, code: t.code, title: t.title, category: t.category, type: t.type,
      start: iso(t.startDate), end: iso(t.endDate), location: t.location,
      seats: t.seats, enrolled: t.enrolled, instructor: t.instructor || "", desc: t.description || "",
      status: t.status, registrationOpen: t.status === "open",
      targetAudience: t.targetAudience || "", provider: t.provider || "", instructorLocation: t.instructorLocation || ""
    })),
    // L&D only: everyone known to the portal, for the "Add person" picker on a session
    directory: directory.map(e => ({ value: `${e.name} <${e.email}>`, id: e.id })),
    requests: requests.map(r => ({
      id: r.id, who: r.employeeId, tid: r.trainingId,
      chain: r.steps.map(s => s.approverId), step: r.currentStep, state: r.state,
      // Final approval decision, for L&D traceability: "approved" | "rejected" | "waiting" | "" (no approver, e.g. added by L&D)
      approval: r.steps.length ? r.steps[r.steps.length - 1].status : "",
      approvedAt: r.steps.length && r.steps[r.steps.length - 1].decidedAt ? pretty(r.steps[r.steps.length - 1].decidedAt!) : "",
      submitted: pretty(r.submittedAt), submittedAt: r.submittedAt.toISOString(),
      justification: r.justification || "—", form: r.form, comment: r.decisionComment || "",
      // Feedback survey email (L&D's Surveys page)
      surveySent: r.surveySentAt ? pretty(r.surveySentAt) : "", surveyReminders: r.surveyReminders
    })),
    attended: Object.fromEntries(attendance.map(a => [`${a.trainingId}:${a.employeeId}`, a.attended])),
    days,
    history,
    // L&D only: what the last history import loaded
    historyStats: hs ? { records: hs.records, people: hs.people, first: hs.first, last: hs.last, at: hs.at ? pretty(hs.at) : "" } : null,
    instructors: instructors.map(p => ({ id: p.id, name: p.name, title: p.title || "", bio: p.bio || "", link: p.link || "", fileName: p.fileName || "" })),
    // L&D only: who has answered each training's feedback survey ("tid:emp" → date)
    surveyAnswered: Object.fromEntries(surveyResponses.map(r => [`${r.trainingId}:${r.employeeId}`, pretty(r.createdAt)])),
    templatesOff: Object.fromEntries(templates.filter(t => !t.isActive).map(t => [t.id, true])),
    templates: templates.map(t => ({ id: t.id, name: t.name, trigger: t.trigger, subject: t.subject, body: t.body })),
    mail: me.isAdmin
      ? {
          from: process.env.LD_MAIL_FROM || "",
          configured: !!process.env.LD_N8N_EMAIL_WEBHOOK_URL,
          testRecipient: (process.env.LD_MAIL_TEST_RECIPIENT || "").trim()
        }
      : null
  };
}

export type Snapshot = Awaited<ReturnType<typeof loadSnapshot>>;
