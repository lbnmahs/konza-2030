// deno task retire-agents            dry run: lists what would be deleted, deletes nothing
// deno task retire-agents --apply    deletes it (Mahs runs this; the deletion is permanent)
//
// K0 (MED-248): retires the 15 agents Konza drops. For the 10 legacy agents and KE_SPIKE it first
// deletes their stored conversations (voice recordings, unlimited retention). The 4 country
// agents kept no audio and their transcripts expire after 30 days. Then it deletes the agents,
// the webhook tools only they used, and their AGENT_ID_* lines in .env. KE is never touched.

import { eleven } from "./_eleven.ts";

const LEGACY = [
  "S1",
  "S1_SW",
  "S2",
  "S3",
  "S4",
  "KE_ID",
  "KE_HEALTH",
  "KE_DISABILITY",
  "AE_ID",
  "AE_TEXT",
  "KE_SPIKE",
];
const COUNTRY = ["UK", "UK_SW", "AE", "DE"];
/** Tool JSONs removed in K0 (MED-246) and the P13 spike tool. */
const RETIRED_TOOLS = [
  "benefits_create_child_benefit_draft",
  "blocked_account_status",
  "blue_badge_create_draft",
  "council_get_collection_status",
  "council_lookup_property",
  "council_report_missed_collection",
  "council_tax_apply_exemption",
  "council_tax_get_summary",
  "de_visa_checklist",
  "de_visa_quote",
  "draft_share",
  "echo_test",
  "gp_register",
  "id_book_delivery",
  "newborn_create_case",
  "pcn_lookup",
  "pcn_submit_challenge",
  "registry_book_appointment",
  "registry_find_office",
  "registry_list_slots",
  "reminders_schedule",
  "residency_book_biometrics",
  "residency_create_upload_link",
  "residency_get_application",
  "residency_list_biometric_slots",
  "rules_council_tax_exemption",
  "rules_life_event_plan",
  "rules_newborn_timeline",
  "rules_pcn_options",
  "sight_get_registration",
  "spike_capability_enter",
  "visa_checklist",
  "visa_quote",
];

const apply = Deno.args.includes("--apply");
const keep = Deno.env.get("AGENT_ID_KE");

async function conversationIds(agentId: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor = "";
  do {
    const page = await eleven(
      "GET",
      `/conversations?agent_id=${encodeURIComponent(agentId)}&page_size=100${
        cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
      }`,
    );
    const convs = page.conversations ?? [];
    // Never trust the filter alone: a conversation of any other agent stops the run.
    if (convs.some((c: any) => c.agent_id !== agentId)) {
      throw new Error("conversation list returned another agent's conversations; stopped");
    }
    ids.push(...convs.map((c: any) => c.conversation_id));
    cursor = page.has_more ? page.next_cursor : "";
  } while (cursor);
  return ids;
}

console.log(apply ? "APPLY: deleting permanently." : "Dry run: nothing is deleted.");

// 1. Conversations, then agents.
const retiredIds = new Set<string>();
for (const key of [...LEGACY, ...COUNTRY]) {
  const id = Deno.env.get(`AGENT_ID_${key}`);
  if (!id) {
    console.log(`${key}: no AGENT_ID_${key} in .env, skipped`);
    continue;
  }
  if (id === keep) throw new Error(`${key} has the KE agent id; refusing`);
  let agent: any;
  try {
    agent = await eleven("GET", `/agents/${id}`);
  } catch {
    console.log(`${key}: agent already gone`);
    continue;
  }
  retiredIds.add(id);
  const convs = LEGACY.includes(key) ? await conversationIds(id) : [];
  console.log(
    `${key}: ${agent.name}${LEGACY.includes(key) ? `, ${convs.length} conversations` : ""}`,
  );
  if (!apply) continue;
  for (const c of convs) await eleven("DELETE", `/conversations/${c}`);
  if (LEGACY.includes(key) && (await conversationIds(id)).length) {
    throw new Error(`${key}: conversations left after delete; agent kept`);
  }
  await eleven("DELETE", `/agents/${id}`);
  console.log(`${key}: deleted`);
}

// 2. Tools only the retired agents used (never one an existing agent still uses).
// Deleted agents can leave their "Main" branch behind as a dependent ("Unknown / Main"), which
// blocks a plain delete. Such a tool is force-deleted only when every dependent belongs to an
// agent that no longer exists or is being retired; a tool any live agent uses is kept.
const live = new Set<string>(
  ((await eleven("GET", "/agents?page_size=100")).agents ?? []).map((a: any) => a.agent_id),
);
const tools = (await eleven("GET", "/tools")).tools ?? [];
for (const t of tools.filter((t: any) => RETIRED_TOOLS.includes(t.tool_config?.name))) {
  const d = await eleven("GET", `/tools/${t.id}/dependent-agents`);
  const deps = [...(d.agents ?? []), ...(d.branches ?? [])];
  const blocking = deps.filter((a: any) => {
    const id = a.agent_id ?? a.id;
    return !id || (live.has(id) && !retiredIds.has(id));
  });
  if (blocking.length || d.has_more) {
    console.log(`tool ${t.tool_config.name}: still used by a live agent, kept`);
    continue;
  }
  console.log(`tool ${t.tool_config.name}${apply ? ": deleted" : ""}`);
  if (apply) await eleven("DELETE", `/tools/${t.id}${deps.length ? "?force=true" : ""}`);
}

// 3. .env lines of the retired agents.
if (apply) {
  const path = new URL("../.env", import.meta.url);
  const lines = (await Deno.readTextFile(path)).split("\n");
  const drop = new RegExp(`^AGENT_ID_(${[...LEGACY, ...COUNTRY].join("|")})=`);
  await Deno.writeTextFile(path, lines.filter((l) => !drop.test(l)).join("\n"));
  console.log("Removed retired AGENT_ID_* lines from .env");
}
