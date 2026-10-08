import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { panelUser } from "@/lib/auth";
import { getServiceSupabase } from "@/lib/supabase-server";
import Handset from "./Handset";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Virtual handset", robots: { index: false } };

// Browser calls to the country agents (T2). Signed-in panel users only.
export default async function HandsetPage() {
  if (!(await panelUser())) redirect("/signin");
  const { data } = await getServiceSupabase().from("demo_agents")
    .select("scenario, authority_name").not("hub", "is", null).order("scenario");
  return <Handset agents={data ?? []} />;
}
