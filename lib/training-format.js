// Date-range formatting shared by the UI, emails and nameplates. Dates are "YYYY-MM-DD" strings.
const SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function dateRange(start, end) {
  const a = Number(start.slice(8, 10)), b = Number(end.slice(8, 10));
  const ma = Number(start.slice(5, 7)) - 1, mb = Number(end.slice(5, 7)) - 1;
  const ya = start.slice(0, 4), yb = end.slice(0, 4);
  if (start === end) return `${b} ${SHORT[mb]} ${yb}`;
  if (ya !== yb) return `${a} ${SHORT[ma]} ${ya} – ${b} ${SHORT[mb]} ${yb}`;
  return ma === mb ? `${a}–${b} ${SHORT[mb]} ${yb}` : `${a} ${SHORT[ma]} – ${b} ${SHORT[mb]} ${yb}`;
}
