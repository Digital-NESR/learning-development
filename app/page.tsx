import { redirect } from "next/navigation";
import { currentEmployee } from "@/auth";
import { loadSnapshot } from "@/lib/data";
import { ensureManager } from "@/lib/graph";
import Portal from "@/components/Portal";

export const dynamic = "force-dynamic";

export default async function Home() {
  const me = await currentEmployee();
  if (!me) redirect("/login");
  // If sign-in couldn't read the line manager, try again with the app's own Graph access (no-op if already known).
  await ensureManager(me);
  const initial = await loadSnapshot(me.id);
  return <Portal initial={initial} />;
}
