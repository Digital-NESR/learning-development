import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { safeEqual } from "@/lib/safe-equal";
import { surveyCron } from "@/lib/survey-mail";

export const runtime = "nodejs";

/**
 * Daily job (Vercel Cron, see vercel.json): reminds approvers about requests still pending.
 * A request is reminded once it has waited LD_REMINDER_AFTER_DAYS (default 2), then again
 * every LD_REMINDER_EVERY_DAYS (default 2) while it stays pending.
 * The same job emails feedback survey links the day after a training ends, and survey reminders.
 * Vercel sends "Authorization: Bearer <CRON_SECRET>"; without CRON_SECRET the job refuses to run.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET || "";
  const sent = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (!secret || !safeEqual(sent, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const afterDays = Math.max(1, Number(process.env.LD_REMINDER_AFTER_DAYS) || 2);
  const everyDays = Math.max(1, Number(process.env.LD_REMINDER_EVERY_DAYS) || 2);
  const now = Date.now();
  const waitedSince = new Date(now - afterDays * 86400000);
  const remindedBefore = new Date(now - everyDays * 86400000);

  const due = await prisma.trainingRequest.findMany({
    where: {
      state: "pending",
      submittedAt: { lte: waitedSince },
      OR: [{ lastRemindedAt: null }, { lastRemindedAt: { lte: remindedBefore } }],
      training: { isActive: true, status: { notIn: ["cancelled", "completed"] } }
    },
    include: { employee: true, training: true, steps: { orderBy: { stepNo: "asc" }, include: { approver: true } } }
  });

  let reminded = 0;
  for (const r of due) {
    const approver = r.steps[r.currentStep]?.approver;
    if (!approver) continue;
    await notify("reminder", r.training, [{ to: approver, employeeName: r.employee.name, managerName: approver.name }]);
    await prisma.trainingRequest.update({ where: { id: r.id }, data: { lastRemindedAt: new Date() } });
    reminded++;
  }
  console.info(`[cron] approval reminders: ${reminded} sent (${due.length} due)`);
  const surveys = await surveyCron();
  console.info(`[cron] surveys: ${surveys.sent} links, ${surveys.reminded} reminders (${surveys.trainings} trainings)`);
  return NextResponse.json({ ok: true, due: due.length, reminded, surveys });
}
