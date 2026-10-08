// Sessions are keyed by the ElevenLabs conversation_id, which ElevenLabs injects into every
// tool call. No token ever passes through the LLM.

import { audit } from "./audit.ts";
import { AUTHORITIES, authority } from "./authorities.ts";
import { type Agent, db, must, ToolError } from "./db.ts";
import { sms } from "./sms.ts";
import { codeTwiml, voiceCall } from "./voice.ts";
import { otpMessage } from "./templates.ts";
import { digits, isUuid, LANGUAGE_NAMES, mask, sha256, str } from "./util.ts";

const VERIFIED_FOR_MS = 15 * 60_000;
/** Money and irreversible tools on a country agent need a check this recent (step-up). */
export const STEP_UP_MS = 5 * 60_000;
const CODE_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;
const MAX_STARTS = 5;
/** Daily code limits beyond one call: per citizen, per calling number, for the whole demo. */
const DAY_MS = 24 * 3600_000;
const MAX_STARTS_PER_CITIZEN_DAY = 5;
const MAX_STARTS_PER_CALLER_DAY = 5;
const MAX_STARTS_GLOBAL_DAY = 50;

/** OTP hashes use their own pepper, never the tool secret. */
const pepper = () => {
  const p = Deno.env.get("OTP_PEPPER");
  if (!p) throw new Error("OTP_PEPPER is not set");
  return p;
};
/** A one-time code's hash, bound to its row id (identity codes; K3 payment codes too). */
export const codeHash = (id: string, code: string) => sha256(`${id}:${code}:${pepper()}`);

/** Authorities whose citizens this agent may verify: a country agent covers its country. */
function identityAuthorities(agent: Agent): string[] {
  if (!agent.hub) return [agent.authority];
  const country = authority(agent.authority).country;
  return Object.values(AUTHORITIES).filter((a) => a.country === country).map((a) => a.id);
}

/** Refuses a new code when a daily limit is reached (audited, no detail to the caller). */
async function dailyLimits(conversationId: string, agent: Agent, citizenId: string) {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const count = async (q: any) => (await q).count ?? 0;
  const perCitizen = await count(
    db.from("verifications").select("id", { count: "exact", head: true })
      .eq("citizen_id", citizenId).gt("created_at", since),
  );
  const global = await count(
    db.from("verifications").select("id", { count: "exact", head: true }).gt("created_at", since),
  );
  let perCaller = 0;
  const conv = must(
    await db.from("conversations").select("caller_hash").eq("id", conversationId).maybeSingle(),
  );
  if (conv?.caller_hash) {
    const convs = must(
      await db.from("conversations").select("id").eq("caller_hash", conv.caller_hash)
        .gt("started_at", since),
    ).map((c: any) => c.id);
    perCaller = await count(
      db.from("verifications").select("id", { count: "exact", head: true })
        .in("conversation_id", convs).gt("created_at", since),
    );
  }
  const hit = perCitizen >= MAX_STARTS_PER_CITIZEN_DAY
    ? "citizen"
    : perCaller >= MAX_STARTS_PER_CALLER_DAY
    ? "caller"
    : global >= MAX_STARTS_GLOBAL_DAY
    ? "global"
    : null;
  if (hit) {
    await audit(conversationId, agent.authority, "Identity", `Daily code limit reached (${hit})`, {
      result: "warn",
    });
    throw new ToolError(
      "too_many_attempts",
      "No more codes can be sent today. Offer a case so an officer can call back.",
    );
  }
}

export type Citizen = {
  id: string;
  full_name: string;
  dob: string;
  id_number: string;
  phone: string;
  preferred_language: string | null;
  authority: string;
};

type Verification = {
  id: string;
  citizen_id: string;
  code_hash: string;
  attempts: number;
  expires_at: string;
  verified_at: string | null;
};

const agentCache = new Map<string, Agent>();

export async function agentFor(agentId: string): Promise<Agent> {
  const hit = agentCache.get(agentId);
  if (hit) return hit;
  const row = must(await db.from("demo_agents").select("*").eq("agent_id", agentId).maybeSingle());
  if (!row) throw new Error(`Unknown agent ${agentId}: run deno task demo to register agents`);
  agentCache.set(agentId, row as Agent);
  return row as Agent;
}

/** Creates the conversation (and its "Call started" row) the first time we see it. */
export async function ensureConversation(conversationId: string, agent: Agent): Promise<void> {
  // Calls start in the authority's greeting language (see call_started).
  const language = authority(agent.authority).default_language;
  const inserted = must(
    await db.from("conversations").upsert(
      {
        id: conversationId,
        agent_id: agent.agent_id,
        authority: agent.authority,
        language,
      },
      { onConflict: "id", ignoreDuplicates: true },
    ).select("id"),
  );
  if (inserted.length) {
    await audit(
      conversationId,
      agent.authority,
      "Call",
      `Call started · ${agent.authority_name} · ${LANGUAGE_NAMES[language] ?? language}`,
    );
  }
}

const normId = (s: string) => s.replace(/[^0-9A-Za-z]/g, "").toUpperCase();

export async function startOtp(
  conversationId: string,
  agent: Agent,
  args: Record<string, unknown>,
) {
  const idNumber = normId(str(args.id_number));
  const dob = str(args.date_of_birth);

  // Country agents: a caller verified in the last 5 minutes is not sent another code when the
  // service changes (Kenya T1 on 1 Oct: the model restarted verification on going back to a
  // step). After 5 minutes a new code is sent, for the step-up on money tools.
  if (agent.hub) {
    const conv = must(
      await db.from("conversations").select("verified_at, citizen_id").eq("id", conversationId)
        .maybeSingle(),
    );
    if (
      conv?.verified_at && conv.citizen_id &&
      Date.now() - new Date(conv.verified_at).getTime() < STEP_UP_MS
    ) {
      const c = must(
        await db.from("citizens").select("full_name, id_number, dob").eq("id", conv.citizen_id)
          .single(),
      );
      // Only the same person: someone else taking over the call gets their own check (P14
      // handset: a friend was registered with the first caller's verification).
      if (normId(c.id_number) === idNumber && String(c.dob) === dob) {
        return {
          already_verified: true,
          first_name: c.full_name.split(" ")[0],
          next: "The caller is already verified on this call. Do not ask for a code; carry on.",
        };
      }
    }
  }

  const { count } = await db.from("verifications").select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId);
  if ((count ?? 0) >= MAX_STARTS) {
    await audit(conversationId, agent.authority, "Identity", "Too many verification attempts", {
      result: "warn",
    });
    throw new ToolError(
      "too_many_attempts",
      "Too many verification attempts on this call. Offer a case so an officer can call back.",
    );
  }

  const candidates = must(
    await db.from("citizens").select("*").in("authority", identityAuthorities(agent)).eq(
      "dob",
      dob || "1900-01-01",
    ),
  ) as Citizen[];
  const citizen = candidates.find((c) => normId(c.id_number) === idNumber);

  if (!citizen) {
    await audit(conversationId, agent.authority, "Identity", "Details did not match a record", {
      data_used: idNumber ? mask("ID", idNumber) : undefined,
      result: "warn",
    });
    throw new ToolError(
      "no_match",
      "Those details do not match our records. Ask the caller to check the number and date of birth and try again. Do not say which one was wrong.",
    );
  }

  // An LLM retry within 30 s reuses the code already sent instead of texting a new one.
  const recent = must(
    await db.from("verifications").select("id, created_at").eq("conversation_id", conversationId)
      .eq("citizen_id", citizen.id).is("verified_at", null)
      .gt("created_at", new Date(Date.now() - 30_000).toISOString())
      .order("created_at", { ascending: false }).limit(1),
  );
  if (recent.length) {
    return { verification_id: recent[0].id, phone_last3: citizen.phone.slice(-3), code_sent: true };
  }

  await dailyLimits(conversationId, agent, citizen.id);

  const id = crypto.randomUUID();
  const code = digits(6);
  must(
    await db.from("verifications").insert({
      id,
      conversation_id: conversationId,
      citizen_id: citizen.id,
      code_hash: await codeHash(id, code),
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    }),
  );
  // Voice call instead of SMS when asked, or when the caller noted "codes by voice call".
  const voiceNoted = must(
    await db.from("adjustments").select("id").eq("conversation_id", conversationId)
      .eq("adjustment", "voice_otp").limit(1),
  ).length > 0;
  const channel = str(args.channel) === "voice" || voiceNoted ? "voice" : "sms";
  if (channel === "voice") {
    await voiceCall(citizen.phone, codeTwiml(agent.authority_name, code), conversationId);
  } else {
    await sms(citizen.phone, otpMessage(agent.authority, code), conversationId);
  }
  await audit(
    conversationId,
    agent.authority,
    "Identity",
    `Code sent by ${channel === "voice" ? "voice call" : "SMS"} to phone ending ${
      citizen.phone.slice(-3)
    }`,
    {
      data_used: mask("ID", citizen.id_number),
    },
  );
  return {
    verification_id: id,
    phone_last3: citizen.phone.slice(-3),
    code_sent: true,
    channel,
    ...(channel === "voice"
      ? {
        next:
          "A phone call to the number on file will read the code twice. The caller may need to hold this call to answer it. Ask them to tell you the code.",
      }
      : {}),
  };
}

export async function checkOtp(
  conversationId: string,
  agent: Agent,
  args: Record<string, unknown>,
) {
  const verificationId = str(args.verification_id);
  const code = str(args.code).replace(/\D/g, "");
  if (!isUuid(verificationId)) {
    throw new ToolError(
      "unknown_verification",
      "Start verification again with identity_start_otp.",
    );
  }
  const v = must(
    await db.from("verifications").select("*").eq("id", verificationId)
      .eq("conversation_id", conversationId).maybeSingle(),
  ) as Verification | null;
  if (!v) {
    throw new ToolError(
      "unknown_verification",
      "Start verification again with identity_start_otp.",
    );
  }

  const citizen = must(
    await db.from("citizens").select("*").eq("id", v.citizen_id).single(),
  ) as Citizen;
  const firstName = citizen.full_name.split(" ")[0];
  if (v.verified_at) return { verified: true, first_name: firstName };

  if (new Date(v.expires_at).getTime() < Date.now()) {
    await audit(conversationId, agent.authority, "Identity", "Code expired", { result: "warn" });
    throw new ToolError("expired", "The code has expired. Offer to send a new one.");
  }
  if (v.attempts >= MAX_ATTEMPTS) {
    throw new ToolError("too_many_attempts", "Too many wrong codes. Offer to send a new one.");
  }

  const ok = v.code_hash === await codeHash(v.id, code);
  if (!ok) {
    const attempts = v.attempts + 1;
    must(await db.from("verifications").update({ attempts }).eq("id", v.id));
    await audit(conversationId, agent.authority, "Identity", "Wrong code entered", {
      result: "warn",
    });
    throw new ToolError("wrong_code", "That code is not right. Ask the caller to read it again.", {
      attempts_left: MAX_ATTEMPTS - attempts,
    });
  }

  const now = new Date().toISOString();
  must(await db.from("verifications").update({ verified_at: now }).eq("id", v.id));
  must(
    await db.from("conversations").update({ verified_at: now, citizen_id: citizen.id })
      .eq("id", conversationId),
  );
  await audit(conversationId, agent.authority, "Identity", "Verified", {
    data_used: mask("ID", citizen.id_number),
  });
  return { verified: true, first_name: firstName };
}

/** Returns the verified citizen for this conversation, or throws not_verified (and audits it). */
export async function requireVerified(
  conversationId: string,
  agent: Agent,
  tool: string,
  withinMs = VERIFIED_FOR_MS,
): Promise<Citizen> {
  const conv = must(
    await db.from("conversations").select("verified_at, citizen_id").eq("id", conversationId)
      .maybeSingle(),
  ) as { verified_at: string | null; citizen_id: string | null } | null;
  const age = conv?.verified_at ? Date.now() - new Date(conv.verified_at).getTime() : Infinity;
  if (conv?.citizen_id && age < VERIFIED_FOR_MS && age >= withinMs) {
    await audit(conversationId, agent.authority, "Identity", `Step-up needed for ${tool}`, {
      result: "warn",
    });
    throw new ToolError(
      "step_up",
      "This needs a fresh code because the last check was more than 5 minutes ago. Tell the caller, then use identity_start_otp and identity_check_otp again.",
    );
  }
  if (age >= VERIFIED_FOR_MS || !conv?.citizen_id) {
    await audit(
      conversationId,
      agent.authority,
      "Identity",
      `Blocked ${tool}: caller not verified`,
      {
        result: "warn",
      },
    );
    throw new ToolError(
      "not_verified",
      "This needs identity verification first. Use identity_start_otp, then identity_check_otp.",
    );
  }
  return must(await db.from("citizens").select("*").eq("id", conv.citizen_id).single()) as Citizen;
}
