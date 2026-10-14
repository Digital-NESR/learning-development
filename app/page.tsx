import { redirect } from "next/navigation";
import { currentEmployee } from "@/auth";
import { loadSnapshot } from "@/lib/data";
import Portal from "@/components/Portal";

export const dynamic = "force-dynamic";

export default async function Home() {
  const me = await currentEmployee();
  if (!me) redirect("/login");
  const initial = await loadSnapshot(me.id);
  return <Portal initial={initial} />;
}
