// deno task approve <application ref>
// Demo stand-in for a caseworker approving an application. For a Wezesha Njema tax exemption
// (WNC-TX-...) it issues the certificate (DS-05); then it releases every partner referral
// scheduled for that application, filling in the values that only exist after approval.

import { createClient } from "npm:@supabase/supabase-js@2";
import { certificateDates } from "../supabase/functions/_shared/rules/ke/ds.ts";
import { todayIn } from "../supabase/functions/_shared/rules/common/dates.ts";
import { env } from "./_eleven.ts";

const ref = (Deno.args[0] ?? "").trim();
if (!ref) {
  console.error("Usage: deno task approve <application ref>");
  Deno.exit(1);
}
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});
const must = (r: { data: any; error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

// Values released on approval, by field name.
const released: Record<string, string> = {};
const app = must(
  await db.from("tax_exemption_applications").select("*").eq("ref", ref).maybeSingle(),
);
if (app) {
  let a = app;
  if (app.status !== "approved") {
    const dates = certificateDates(todayIn("Africa/Nairobi"));
    const certificate = `KN-EX-${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}`;
    a = must(
      await db.from("tax_exemption_applications").update({
        status: "approved",
        certificate_no: certificate,
        start_date: dates.start_date,
        valid_until: dates.valid_until,
      }).eq("id", app.id).select("*").single(),
    );
    await db.from("audit_log").insert({
      conversation_id: app.conversation_id,
      authority: "wezesha_njema",
      actor: "Rules",
      action:
        `${ref} approved after vetting: certificate issued, valid 5 years from ${dates.start_date}`,
      result: "ok",
      rule_ids: ["DS-05"],
    });
    console.log(`Approved ${ref}: certificate ${certificate}, from ${dates.start_date}.`);
  }
  released.certificate_number = a.certificate_no;
  released.start_date = a.start_date;
}

const rows = must(
  await db.from("partner_referrals")
    .select("id, conversation_id, fields_sent, partners(name, authority)")
    .eq("linked_ref", ref).eq("status", "scheduled"),
);
if (!rows.length) console.log(`No partner referrals scheduled for ${ref}.`);
for (const r of rows as any[]) {
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.fields_sent as Record<string, string>)) {
    fields[k] = v === "released on approval" ? (released[k] ?? v) : v;
  }
  await db.from("partner_referrals").update({
    status: "sent",
    sent_at: new Date().toISOString(),
    fields_sent: fields,
  }).eq("id", r.id);
  await db.from("audit_log").insert({
    conversation_id: r.conversation_id,
    authority: r.partners.authority,
    actor: "Partner",
    action: `${ref} approved: shared with ${r.partners.name}, ${Object.keys(fields).length} fields`,
    data_used: Object.keys(fields).join(", "),
    result: "ok",
    rule_ids: [],
  });
  console.log(`Released to ${r.partners.name}.`);
}
