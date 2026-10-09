import "server-only";
import { getServiceSupabase } from "@/lib/supabase-server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Receipt = {
  id: string;
  outcome: string;
  decided_by: string | null;
  rule_ids: string[];
  reason_en: string;
  next_en: string | null;
  inputs: Record<string, unknown>;
  decided_at: string | null;
  created_at: string;
  application: { ref: string; agency: string; service: string };
};

/** A decision's receipt by its random id (the link in the receipt SMS), or null. No names,
 * resident numbers or addresses are read. */
export async function receipt(id: string): Promise<Receipt | null> {
  if (!UUID_RE.test(id)) return null;
  const { data } = await getServiceSupabase().from("konza_decisions")
    .select(
      "id, outcome, decided_by, rule_ids, reason_en, next_en, inputs, decided_at, created_at, application:konza_applications(ref, agency, service)",
    )
    .eq("id", id).maybeSingle<Receipt>();
  return data ?? null;
}
