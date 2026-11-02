import "server-only";
import type { Prisma } from "@prisma/client";
import { trainingDays } from "@/lib/training-days.js";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Records one training day for one person (QR check-in or L&D), or clears it (present = null).
 * When someone is present on every day of the training they are marked Attended overall,
 * which completes their request, exactly as if L&D had pressed "Attended". Changing a day back removes it.
 */
export async function recordDay(
  tx: Prisma.TransactionClient,
  t: { id: string; startDate: Date; endDate: Date },
  employeeId: string, day: string, present: boolean | null, method: "qr" | "manual", markedById: string | null
) {
  const key = { trainingId_employeeId_day: { trainingId: t.id, employeeId, day: new Date(day + "T00:00:00Z") } };
  if (present === null) {
    await tx.attendanceDay.deleteMany({ where: { trainingId: t.id, employeeId, day: new Date(day + "T00:00:00Z") } });
  } else {
    await tx.attendanceDay.upsert({
      where: key,
      update: { present, method, markedById, at: new Date() },
      create: { trainingId: t.id, employeeId, day: new Date(day + "T00:00:00Z"), present, method, markedById }
    });
  }

  const days = trainingDays(iso(t.startDate), iso(t.endDate));
  const marked = await tx.attendanceDay.findMany({ where: { trainingId: t.id, employeeId, present: true } });
  const presentDays = new Set(marked.map(m => iso(m.day)));
  if (days.every(d => presentDays.has(d))) {
    await tx.attendance.upsert({
      where: { trainingId_employeeId: { trainingId: t.id, employeeId } },
      update: { attended: true, markedById },
      create: { trainingId: t.id, employeeId, attended: true, markedById }
    });
    await tx.trainingRequest.updateMany({ where: { trainingId: t.id, employeeId, state: "enrolled" }, data: { state: "completed" } });
  } else if (present !== true) {
    // A day was changed to absent or cleared: they no longer qualify automatically, so remove "Attended"
    // (L&D can still press "Attended" by hand for partial attendance).
    const removed = await tx.attendance.deleteMany({ where: { trainingId: t.id, employeeId, attended: true } });
    if (removed.count) await tx.trainingRequest.updateMany({ where: { trainingId: t.id, employeeId, state: "completed" }, data: { state: "enrolled" } });
  }
}
