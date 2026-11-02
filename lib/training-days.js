// Training days and long-form dates, shared by the UI, attendance, QR codes and certificates.
// Dates are "YYYY-MM-DD" strings.
const LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const WEEKDAY = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

/** Every calendar day from start to end inclusive (at most 31). */
export function trainingDays(start, end) {
  const out = [];
  const d = new Date(start + "T00:00:00Z"), last = new Date(end + "T00:00:00Z");
  while (d <= last && out.length < 31) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out.length ? out : [start];
}

/** "25 October 2026" */
export function longDate(iso) {
  return Number(iso.slice(8, 10)) + " " + LONG[Number(iso.slice(5, 7)) - 1] + " " + iso.slice(0, 4);
}

/** "Sunday 25 October 2026" */
export function weekdayDate(iso) {
  return WEEKDAY[new Date(iso + "T00:00:00Z").getUTCDay()] + " " + longDate(iso);
}

/** "25 - 29 October 2026", "30 October - 2 November 2026" or "25 October 2026" — the certificate style. */
export function longDateRange(start, end) {
  if (start === end) return longDate(start);
  const [ya, ma, da] = [start.slice(0, 4), Number(start.slice(5, 7)) - 1, Number(start.slice(8, 10))];
  const [yb, mb, db] = [end.slice(0, 4), Number(end.slice(5, 7)) - 1, Number(end.slice(8, 10))];
  if (ya !== yb) return longDate(start) + " - " + longDate(end);
  if (ma !== mb) return da + " " + LONG[ma] + " - " + db + " " + LONG[mb] + " " + yb;
  return da + " - " + db + " " + LONG[mb] + " " + yb;
}
