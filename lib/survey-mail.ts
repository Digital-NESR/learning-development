import "server-only";
import type { Prisma, Training } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";

// Feedback survey emails: the link goes out the day after a training ends (or when L&D sends it),
// then reminders follow until the person answers.

/** Days between reminders, and how many reminders at most. */
export const SURVEY_REMIND_EVERY_DAYS = Math.max(1, Number(process.env.LD_SURVEY_REMINDER_EVERY_DAYS) || 2);
export const SURVEY_MAX_REMINDERS = 3;

/**
 * Participants who should get the survey: registered or completed, not marked No show,
 * not external (never emailed) and who haven't answered yet.
 */
async function outstanding(t: Training, where: Prisma.TrainingRequestWhereInput) {
  const [requests, noShows, answered] = await Promise.all([
    prisma.trainingRequest.findMany({
      where: { trainingId: t.id, state: { in: ["enrolled", "completed"] }, employee: { isExternal: false }, ...where },
      include: { employee: true }
    }),
    prisma.attendance.findMany({ where: { trainingId: t.id, attended: false }, select: { employeeId: true } }),
    prisma.surveyResponse.findMany({ where: { trainingId: t.id }, select: { employeeId: true } })
  ]);
  const skip = new Set([...noShows, ...answered].map(x => x.employeeId));
  return requests.filter(r => !skip.has(r.employeeId) && !r.employee.email.endsWith("@external.invalid"));
}

/**
 * Emails the survey link ("send": everyone not sent it yet) or a reminder ("remind": everyone sent it
 * who hasn't answered; `due` limits reminders to those last emailed long enough ago).
 * Returns how many people were due and how many were emailed (0 if the email couldn't be sent).
 */
export async function sendSurveyEmails(t: Training, mode: "send" | "remind", opts: { actorId?: string; due?: boolean } = {}) {
  const cutoff = new Date(Date.now() - SURVEY_REMIND_EVERY_DAYS * 86400000);
  const where: Prisma.TrainingRequestWhereInput = mode === "send"
    ? { surveySentAt: null }
    : opts.due
      ? { surveySentAt: { lte: cutoff }, surveyReminders: { lt: SURVEY_MAX_REMINDERS }, OR: [{ surveyRemindedAt: null }, { surveyRemindedAt: { lte: cutoff } }] }
      : { surveySentAt: { not: null } };
  const people = await outstanding(t, where);
  if (!people.length) return { due: 0, emailed: 0 };
  const sent = await notify(mode === "send" ? "survey" : "survey_reminder", t, people.map(r => ({ to: r.employee })), opts.actorId);
  if (!sent) return { due: people.length, emailed: 0 };
  const ids = people.map(r => r.id);
  await prisma.trainingRequest.updateMany({
    where: { id: { in: ids } },
    data: mode === "send" ? { surveySentAt: new Date() } : { surveyRemindedAt: new Date(), surveyReminders: { increment: 1 } }
  });
  return { due: people.length, emailed: ids.length };
}

/** Daily job: survey links for trainings that ended (up to 30 days ago), and reminders that are due. */
export async function surveyCron() {
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const trainings = await prisma.training.findMany({
    where: { isActive: true, status: { not: "cancelled" }, endDate: { lt: today, gte: new Date(today.getTime() - 30 * 86400000) } }
  });
  let sent = 0, reminded = 0;
  for (const t of trainings) {
    sent += (await sendSurveyEmails(t, "send")).emailed;
    reminded += (await sendSurveyEmails(t, "remind", { due: true })).emailed;
  }
  return { trainings: trainings.length, sent, reminded };
}
