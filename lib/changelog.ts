import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { statusLabel } from "@/lib/constants.js";

// Session change log for L&D: built from audit_log.
// Covers session edits (field by field, with the reason), status changes, people L&D added / removed / registered
// from the waitlist, and training emails sent from the portal.

/** Editable training fields, in the order they appear in the editor. */
export const TRAINING_FIELDS: [key: string, label: string][] = [
  ["code", "Session code"], ["title", "Training title"], ["instructor", "Instructor"], ["type", "Training category"], ["category", "Training subcategory"],
  ["startDate", "Start date"], ["endDate", "End date"], ["location", "Location"], ["deliveryMethod", "Delivery method"], ["seats", "Seat capacity"], ["status", "Status"],
  ["targetAudience", "Target audience"], ["provider", "Training provider"], ["instructorLocation", "Instructor location"], ["description", "Description"]
];

/** A field's value as plain text for the log ("" when empty). */
export function fieldText(key: string, v: unknown): string {
  if (v == null || v === "") return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (key === "status") return statusLabel(String(v));
  return String(v);
}

/** Field-by-field differences between the stored training and the edited values. */
export function trainingChanges(before: Record<string, unknown>, after: Record<string, unknown>) {
  return TRAINING_FIELDS
    .map(([key, label]) => ({ field: label, from: fieldText(key, before[key]), to: fieldText(key, after[key]) }))
    .filter(c => c.from !== c.to);
}

const SESSION_ACTIONS = ["create", "update", "status", "email"];
const PEOPLE_ACTIONS = ["add_participant", "remove_participant", "add_external", "enroll", "ld_reject"];
const STATE: Record<string, string> = { pending: "Pending Approval", enrolled: "Approved", waitlist: "Waitlisted", rejected: "Rejected", completed: "Completed" };
const AUDIENCE: Record<string, string> = { registered: "everyone registered", enrolled: "registered participants", participants: "attendees" };

export type ChangeEntry = { at: Date; who: string; trainingId: string; what: string; changes: { field: string; from: string; to: string }[]; reason: string };

/** Change log entries, newest first: for one training, or for every training when `trainingId` is omitted. */
export async function loadChangeLog(trainingId?: string, take = 500): Promise<ChangeEntry[]> {
  const where: Prisma.AuditLogWhereInput = {
    OR: [
      { entity: "training", action: { in: SESSION_ACTIONS }, ...(trainingId ? { entityId: trainingId } : {}) },
      { entity: "request", action: { in: PEOPLE_ACTIONS }, ...(trainingId ? { details: { path: ["trainingId"], equals: trainingId } } : {}) }
    ]
  };
  const rows = await prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take });
  const people = await prisma.employee.findMany({
    where: { id: { in: [...new Set(rows.map(r => r.actorId).filter((x): x is string => !!x))] } },
    select: { id: true, name: true }
  });
  const nameOf = new Map(people.map(p => [p.id, p.name]));
  // People added/removed: show their name (older entries only stored the email)
  const emails = [...new Set(rows.map(r => (r.details as Record<string, unknown> | null)?.email).filter((e): e is string => typeof e === "string"))];
  const byEmail = new Map((await prisma.employee.findMany({ where: { email: { in: emails } }, select: { email: true, name: true } })).map(p => [p.email, p.name]));

  return rows.map(r => {
    const d = (r.details || {}) as Record<string, unknown>;
    const person = String(d.name || (d.email && byEmail.get(String(d.email))) || d.email || "someone");
    const changes = Array.isArray(d.changes) ? (d.changes as ChangeEntry["changes"]) : [];
    let what: string;
    switch (r.action) {
      case "create": what = "Created the session"; break;
      case "update": what = changes.length ? "Edited the session" : "Edited the session (field details were not recorded before the change log)"; break;
      case "status":
        what = `Changed the status from ${statusLabel(String(d.from))} to ${statusLabel(String(d.to))}` +
          (Number(d.notified) ? ` (${d.notified} registered ${Number(d.notified) === 1 ? "person was" : "people were"} emailed)` : "");
        break;
      case "email": {
        const n = Number(d.count ?? 0);
        what = `Sent the email "${d.subject || ""}" to ${n} ${n === 1 ? "person" : "people"}` + (AUDIENCE[String(d.audience)] ? ` (${AUDIENCE[String(d.audience)]})` : "");
        break;
      }
      case "add_participant": what = `Added ${person}` + (d.from ? ` (was ${STATE[String(d.from)] || d.from})` : ""); break;
      case "add_external": what = `Added external participant ${person}${d.organization ? ` (${d.organization})` : ""}`; break;
      case "remove_participant": what = `Removed ${person}` + (d.state ? ` (was ${STATE[String(d.state)] || d.state})` : ""); break;
      case "enroll": what = `Registered ${d.name || "a person"} from the waitlist`; break;
      case "ld_reject": what = `Rejected ${person}` + (d.from ? ` (was ${STATE[String(d.from)] || d.from})` : ""); break;
      default: what = r.action;
    }
    const trainingIdOf = r.entity === "training" ? r.entityId : String(d.trainingId || "");
    return { at: r.createdAt, who: (r.actorId && nameOf.get(r.actorId)) || "System", trainingId: trainingIdOf, what, changes, reason: String(d.reason || (r.action === "ld_reject" ? d.comment : "") || "") };
  });
}
