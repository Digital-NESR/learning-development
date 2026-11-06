import "server-only";
import type { Prisma } from "@prisma/client";
import { trainingDays } from "@/lib/training-days.js";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Records one training day for one person (L&D, from the signed attendance sheet), or clears it (present = null).
 * When someone is present on every day of the training they are marked Attended overall,
 * which completes their request. Changing a day back undoes that automatic result only:
 * an Attended / No show that L&D set themselves is left alone.
 */
export async function recordDay(
  tx: Prisma.TransactionClient,
  t: { id: string; startDate: Date; endDate: Date },
  employeeId: string, day: string, present: boolean | null, markedById: string | null
) {
  const date = new Date(day + "T00:00:00Z");
  const key = { trainingId_employeeId_day: { trainingId: t.id, employeeId, day: date } };
  if (present === null) {
    await tx.attendanceDay.deleteMany({ where: { trainingId: t.id, employeeId, day: date } });
  } else {
    await tx.attendanceDay.upsert({
      where: key,
      update: { present, method: "manual", markedById, at: new Date() },
      create: { trainingId: t.id, employeeId, day: date, present, method: "manual", markedById }
    });
  }

  const days = trainingDays(iso(t.startDate), iso(t.endDate));
  const marked = await tx.attendanceDay.findMany({ where: { trainingId: t.id, employeeId, present: true } });
  const presentDays = new Set(marked.map(m => iso(m.day)));
  const overall = await tx.attendance.findUnique({ where: { trainingId_employeeId: { trainingId: t.id, employeeId } } });
  if (days.every(d => presentDays.has(d))) {
    if (overall?.attended) return; // already Attended
    await tx.attendance.upsert({
      where: { trainingId_employeeId: { trainingId: t.id, employeeId } },
      update: { attended: true, fromDays: true, markedById },
      create: { trainingId: t.id, employeeId, attended: true, fromDays: true, markedById }
    });
    await tx.trainingRequest.updateMany({ where: { trainingId: t.id, employeeId, state: "enrolled" }, data: { state: "completed" } });
  } else if (overall?.attended && overall.fromDays) {
    await tx.attendance.delete({ where: { trainingId_employeeId: { trainingId: t.id, employeeId } } });
    await tx.trainingRequest.updateMany({ where: { trainingId: t.id, employeeId, state: "completed" }, data: { state: "enrolled" } });
  }
}
