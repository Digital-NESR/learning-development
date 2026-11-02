import { redirect } from "next/navigation";
import { currentEmployee } from "@/auth";
import { prisma } from "@/lib/prisma";
import { qrValid } from "@/lib/qr-token";
import { longDateRange } from "@/lib/training-days.js";
import PublicCard from "@/components/PublicCard";
import SurveyForm from "@/components/SurveyForm";

export const dynamic = "force-dynamic";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Training feedback survey, reached by scanning the training's survey QR code. */
export default async function Survey({ searchParams }: { searchParams: Promise<{ t?: string; k?: string }> }) {
  const { t: trainingId = "", k = "" } = await searchParams;
  const me = await currentEmployee();
  if (!me) redirect("/login?callbackUrl=" + encodeURIComponent(`/survey?t=${trainingId}&k=${k}`));

  const t = qrValid("survey", trainingId, "", k) ? await prisma.training.findUnique({ where: { id: trainingId } }) : null;
  if (!t) return <Note title="This survey link isn't valid" text="Please scan the survey QR code again, or ask the L&D team." />;

  const registered = await prisma.trainingRequest.findFirst({ where: { trainingId: t.id, employeeId: me.id, state: { in: ["enrolled", "completed"] } } });
  if (!registered) return <Note title="Only participants can give feedback" text={`You aren't on the participant list for ${t.code} · ${t.title}. If you attended, please let the L&D team know.`} />;

  const existing = await prisma.surveyResponse.findUnique({ where: { trainingId_employeeId: { trainingId: t.id, employeeId: me.id } } });
  return (
    <PublicCard wide>
      <div style={{ fontSize: 20, fontWeight: "bold" }}>Training Feedback Survey</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "6px 18px", marginTop: 14, fontSize: 12.5, background: "#FAFBFA", border: "1px solid #EEF1EF", borderRadius: 4, padding: "12px 14px" }}>
        <div><b>Employee:</b> {me.name}</div>
        <div><b>Employee ID:</b> {me.nesrId || "—"}</div>
        <div><b>Training:</b> {t.title}</div>
        <div><b>Date:</b> {longDateRange(iso(t.startDate), iso(t.endDate))}</div>
        <div><b>Location:</b> {t.location}</div>
        <div><b>Instructor:</b> {t.instructor || "—"}</div>
      </div>
      <div style={{ fontSize: 13, color: "#58595B", margin: "16px 0 4px", lineHeight: 1.5 }}>
        Thank you for attending the training. Please take a few minutes to complete this survey to help us improve future training.
      </div>
      <SurveyForm trainingId={t.id} k={k}
        initial={existing ? { ratings: existing.ratings as Record<string, number | null>, likedBest: existing.likedBest || "", actionPlan: existing.actionPlan || "" } : null} />
    </PublicCard>
  );
}

function Note({ title, text }: { title: string; text: string }) {
  return (
    <PublicCard>
      <div style={{ fontSize: 19, fontWeight: "bold" }}>{title}</div>
      <div style={{ fontSize: 14, color: "#58595B", marginTop: 10, lineHeight: 1.5 }}>{text}</div>
    </PublicCard>
  );
}
