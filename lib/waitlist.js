// Who appears in L&D's Waitlist Queue (shared by the page and its Excel export).
// - Waitlisted: the manager approved, but the class was full or registration had closed.
// - Cancelled session: anyone still registered (pending, registered or waitlisted) when L&D cancelled the training,
//   so L&D can offer them another session.

export const CANCELLED_KEEP = ["pending", "enrolled", "waitlist"];

/** "waitlist" | "cancelled" | null for a request state and its training's status. */
export function waitlistKind(state, trainingStatus) {
  if (trainingStatus === "cancelled") return CANCELLED_KEEP.includes(state) ? "cancelled" : null;
  return state === "waitlist" ? "waitlist" : null;
}

/** Why the person is in the queue. */
export function waitlistReason(kind, t) {
  if (kind === "cancelled") return "Session cancelled";
  if (t.status === "class_full" || t.enrolled >= t.seats) return "Class full";
  if (t.status === "registration_closed") return "Registration closed";
  if (t.status === "ongoing" || t.status === "completed") return "Session already started";
  return "Seat available: can be registered";
}
