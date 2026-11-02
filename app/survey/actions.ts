"use server";

import { currentEmployee } from "@/auth";
import { prisma } from "@/lib/prisma";
import { qrValid } from "@/lib/qr-token";
import { SURVEY_QUESTIONS } from "@/lib/survey.js";

export type SurveyResult = { ok: true } | { ok: false; error: string };

/** Saves (or updates) the signed-in employee's feedback for a training. */
export async function submitSurvey(input: { trainingId: string; k: string; ratings: Record<string, number | null>; likedBest: string; actionPlan: string }): Promise<SurveyResult> {
  const me = await currentEmployee();
  if (!me) return { ok: false, error: "Your session has expired. Sign in again." };
  const trainingId = String(input.trainingId || "");
  if (!qrValid("survey", trainingId, "", String(input.k || ""))) return { ok: false, error: "This survey link isn't valid." };
  const registered = await prisma.trainingRequest.findFirst({ where: { trainingId, employeeId: me.id, state: { in: ["enrolled", "completed"] } } });
  if (!registered) return { ok: false, error: "Only participants of this training can give feedback." };

  const ratings: Record<string, number | null> = {};
  for (const q of SURVEY_QUESTIONS) {
    const v = input.ratings?.[q.id];
    if (v == null && q.optional) { ratings[q.id] = null; continue; }
    if (![1, 2, 3, 4, 5].includes(Number(v))) return { ok: false, error: "Please rate every statement." };
    ratings[q.id] = Number(v);
  }
  const likedBest = String(input.likedBest || "").trim().slice(0, 3000) || null;
  const actionPlan = String(input.actionPlan || "").trim().slice(0, 3000) || null;

  await prisma.surveyResponse.upsert({
    where: { trainingId_employeeId: { trainingId, employeeId: me.id } },
    update: { ratings, likedBest, actionPlan },
    create: { trainingId, employeeId: me.id, ratings, likedBest, actionPlan }
  });
  return { ok: true };
}
