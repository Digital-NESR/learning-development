"use client";

import { useState } from "react";
import { SURVEY_SECTIONS, SURVEY_COMMENTS } from "@/lib/survey.js";
import { submitSurvey } from "@/app/survey/actions";

type Initial = { ratings: Record<string, number | null>; likedBest: string; actionPlan: string } | null;

const SCALE = [1, 2, 3, 4, 5];

export default function SurveyForm({ trainingId, k, initial }: { trainingId: string; k: string; initial: Initial }) {
  const [ratings, setRatings] = useState<Record<string, number | null>>(initial?.ratings || {});
  const [likedBest, setLikedBest] = useState(initial?.likedBest || "");
  const [actionPlan, setActionPlan] = useState(initial?.actionPlan || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div style={{ textAlign: "center", padding: "26px 0 6px" }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#C5E0D2", color: "#1F5E3A", fontSize: 32, fontWeight: "bold", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>✓</div>
        <div style={{ fontSize: 19, fontWeight: "bold" }}>Thank you for your feedback</div>
        <div style={{ fontSize: 13.5, color: "#58595B", marginTop: 8 }}>Your answers were sent to the L&amp;D team. You can scan the code again to change them.</div>
      </div>
    );
  }

  async function send() {
    const gaps = SURVEY_SECTIONS.flatMap(s => s.questions).filter(q => !q.optional && !ratings[q.id]).map(q => q.id);
    setMissing(gaps);
    if (gaps.length) { setError("Please rate every statement (" + gaps.length + " left)."); return; }
    setBusy(true); setError("");
    const r = await submitSurvey({ trainingId, k, ratings, likedBest, actionPlan }).catch(() => ({ ok: false as const, error: "Couldn't send. Check your connection and try again." }));
    setBusy(false);
    if (r.ok) setDone(true); else setError(r.error);
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: "#8A8F8C", marginBottom: 6 }}>Rate each statement from 1 (Poor) to 5 (Excellent).</div>
      {SURVEY_SECTIONS.map(s => (
        <div key={s.title} style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: "bold", color: "#fff", background: "#2A7E4F", padding: "8px 12px", borderRadius: "4px 4px 0 0" }}>{s.title}</div>
          <div style={{ border: "1px solid #E1E5E3", borderTop: 0, borderRadius: "0 0 4px 4px" }}>
            {s.questions.map(q => {
              const v = ratings[q.id];
              const miss = missing.includes(q.id) && !v;
              return (
                <div key={q.id} style={{ padding: "11px 12px", borderBottom: "1px solid #F0F2F1", background: miss ? "#FBF2F2" : "#fff", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                  <div style={{ flex: "1 1 240px", fontSize: 13, lineHeight: 1.4 }}>
                    {q.text}{q.optional && <span style={{ color: "#8A8F8C" }}> (if applicable)</span>}
                  </div>
                  <div style={{ display: "flex", gap: 5 }}>
                    {SCALE.map(n => (
                      <button key={n} type="button" onClick={() => setRatings(r => ({ ...r, [q.id]: n }))} aria-label={`${n} of 5`}
                        style={{ width: 38, height: 38, borderRadius: 4, cursor: "pointer", fontWeight: "bold", fontSize: 14,
                          border: "1px solid " + (v === n ? "#2A7E4F" : "#D1D3D4"), background: v === n ? "#2A7E4F" : "#fff", color: v === n ? "#fff" : "#1F1F1D" }}>{n}</button>
                    ))}
                    {q.optional && (
                      <button type="button" onClick={() => setRatings(r => ({ ...r, [q.id]: null }))}
                        style={{ height: 38, padding: "0 9px", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: "bold",
                          border: "1px solid " + (v == null ? "#58595B" : "#D1D3D4"), background: v == null ? "#58595B" : "#fff", color: v == null ? "#fff" : "#58595B" }}>N/A</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div style={{ marginTop: 18, fontSize: 13, fontWeight: "bold" }}>General Comments</div>
      {SURVEY_COMMENTS.map(c => (
        <label key={c.id} style={{ display: "block", marginTop: 10 }}>
          <div style={{ fontSize: 12.5, color: "#58595B", marginBottom: 5 }}>{c.text}</div>
          <textarea value={c.id === "likedBest" ? likedBest : actionPlan} rows={3}
            onChange={e => (c.id === "likedBest" ? setLikedBest : setActionPlan)(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", padding: "9px 10px", border: "1px solid #D1D3D4", borderRadius: 4, fontSize: 13, fontFamily: "inherit", resize: "vertical" }} />
        </label>
      ))}

      {error && <div style={{ background: "#F7DEDE", color: "#8A2B2B", fontSize: 12.5, padding: "9px 12px", borderRadius: 4, marginTop: 14 }}>{error}</div>}
      <button type="button" onClick={send} disabled={busy}
        style={{ width: "100%", marginTop: 16, padding: "12px 14px", border: 0, borderRadius: 4, background: busy ? "#8A8F8C" : "#2A7E4F", color: "#fff", fontWeight: "bold", fontSize: 14, cursor: busy ? "default" : "pointer" }}>
        {busy ? "Sending…" : initial ? "Update my feedback" : "Submit feedback"}
      </button>
    </div>
  );
}
