import { redirect } from "next/navigation";
import { currentEmployee } from "@/auth";
import { prisma } from "@/lib/prisma";
import { qrValid } from "@/lib/qr-token";
import { recordDay } from "@/lib/attendance";
import { trainingDays, weekdayDate } from "@/lib/training-days.js";
import PublicCard from "@/components/PublicCard";

export const dynamic = "force-dynamic";

const iso = (d: Date) => d.toISOString().slice(0, 10);

// Time zone of each training location, so a day's code only works on that calendar day where the training is held
const ZONES: Record<string, string> = {
  "Al Khobar, KSA": "Asia/Riyadh", "Dammam, KSA": "Asia/Riyadh", "Abu Dhabi, UAE": "Asia/Dubai", "Dubai, UAE": "Asia/Dubai",
  "Cairo, Egypt": "Africa/Cairo", "Houston, USA": "America/Chicago"
};
const localDate = (tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
/** Today's date at the training's location; for virtual or unknown locations, today in any of our locations. */
const todayAt = (location: string) => ZONES[location] ? [localDate(ZONES[location])] : [...new Set(Object.values(ZONES))].map(localDate);

/** Opened by scanning a training day's QR code: marks the signed-in employee present for that day. */
export default async function CheckIn({ searchParams }: { searchParams: Promise<{ t?: string; d?: string; k?: string }> }) {
  const { t: trainingId = "", d: day = "", k = "" } = await searchParams;
  const me = await currentEmployee();
  if (!me) redirect("/login?callbackUrl=" + encodeURIComponent(`/checkin?t=${trainingId}&d=${day}&k=${k}`));

  const t = /^\d{4}-\d{2}-\d{2}$/.test(day) && qrValid("checkin", trainingId, day, k)
    ? await prisma.training.findUnique({ where: { id: trainingId } })
    : null;
  if (!t) return <Message tone="bad" title="This QR code isn't valid" text="Please scan the code shown in the training room again, or ask the L&D team." />;

  const days = trainingDays(iso(t.startDate), iso(t.endDate));
  const n = days.indexOf(day) + 1;
  const heading = `${t.code} · ${t.title}`;
  if (!n) return <Message tone="bad" title="This QR code isn't valid" text="Please scan the code shown in the training room again, or ask the L&D team." />;

  // Only on the day itself, in the training location's time zone
  const today = todayAt(t.location);
  if (!today.includes(day)) {
    const early = today.every(d => d < day);
    return <Message tone="warn" title={`This is the code for Day ${n}`} sub={heading}
      text={early ? `Check-in for Day ${n} opens on ${weekdayDate(day)}. Please scan it on that day.`
        : `Check-in for Day ${n} (${weekdayDate(day)}) has closed. If you attended that day, please let the L&D team know.`} />;
  }

  const request = await prisma.trainingRequest.findFirst({ where: { trainingId: t.id, employeeId: me.id, state: { in: ["enrolled", "completed"] } } });
  if (!request) {
    return <Message tone="warn" title="You're not on the participant list" sub={heading}
      text="Your attendance wasn't recorded because you aren't registered for this training. Please see the L&D team in the room so they can add you." />;
  }

  const already = await prisma.attendanceDay.findUnique({ where: { trainingId_employeeId_day: { trainingId: t.id, employeeId: me.id, day: new Date(day + "T00:00:00Z") } } });
  if (!already?.present) {
    await prisma.$transaction(tx => recordDay(tx, t, me.id, day, true, "qr", me.id));
  }
  return <Message tone="good" title={already?.present ? "You're already checked in" : "You're checked in"} sub={heading}
    text={`${me.name} — Day ${n} of ${days.length}, ${weekdayDate(day)}. Enjoy the session!`} />;
}

function Message({ tone, title, sub, text }: { tone: "good" | "warn" | "bad"; title: string; sub?: string; text: string }) {
  const c = { good: ["#C5E0D2", "#1F5E3A", "✓"], warn: ["#FDF2D9", "#8A6100", "!"], bad: ["#F7DEDE", "#8A2B2B", "×"] }[tone];
  return (
    <PublicCard>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: c[0], color: c[1], fontSize: 32, fontWeight: "bold", display: "flex", alignItems: "center", justifyContent: "center", margin: "6px auto 16px" }}>{c[2]}</div>
        <div style={{ fontSize: 20, fontWeight: "bold" }}>{title}</div>
        {sub && <div style={{ fontSize: 13, fontWeight: "bold", color: "#2A7E4F", marginTop: 8 }}>{sub}</div>}
        <div style={{ fontSize: 14, color: "#58595B", marginTop: 10, lineHeight: 1.5 }}>{text}</div>
      </div>
    </PublicCard>
  );
}
