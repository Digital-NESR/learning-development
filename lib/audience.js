// Who counts as "registered", "enrolled" and "participants" for a training.
// Shared by the UI (recipient counts, roster tabs) and the server (actual recipients).

export const AUDIENCES = [
  { value: "registered", label: "All registered" },
  { value: "enrolled", label: "Enrolled only" },
  { value: "participants", label: "Participants (attended)" }
];

/** Request states that count as registered: everything except declined. */
export const REGISTERED_STATES = ["pending", "lnd", "enrolled", "waitlist", "completed"];
export const ENROLLED_STATES = ["enrolled", "completed"];

/** Employee ids in the audience, given requests [{who, tid, state}] and attendance {"tid:who": bool}. */
export function audienceIds(audience, trainingId, requests, attended) {
  const forT = requests.filter(r => r.tid === trainingId);
  if (audience === "participants") {
    return [...new Set(forT.filter(r => attended[trainingId + ":" + r.who] === true).map(r => r.who))];
  }
  const states = audience === "enrolled" ? ENROLLED_STATES : REGISTERED_STATES;
  return [...new Set(forT.filter(r => states.includes(r.state)).map(r => r.who))];
}

export const PLACEHOLDERS = ["{{first_name}}", "{{employee_name}}", "{{training_title}}", "{{session_code}}", "{{dates}}", "{{location}}", "{{manager_name}}"];

/** Replaces {{placeholders}} in a template string. Unknown placeholders are left as-is. */
export function fillPlaceholders(text, values) {
  return String(text || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (values[k] != null ? String(values[k]) : m));
}
