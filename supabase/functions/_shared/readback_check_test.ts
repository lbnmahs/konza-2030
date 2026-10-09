import { assertEquals } from "jsr:@std/assert@1";
import { rb, readBack } from "./readback.ts";
import { enNumbersToDigits, readBackResults } from "./readback_check.ts";

const rbk = readBack(
  { fee: rb.amount(7550), on: rb.date("2026-10-15") },
  (s) => `Pay ${s.fee}; biometrics on ${s.on}.`,
  (s) => `Lipa ${s.fee}; biometriki ${s.on}.`,
);
const ID = "c0000000-0000-4000-8000-000000000001";

/** prepare, the agent's words, the caller's answer, then the commit. */
const call = (agentSays: string, callerSays: string, tool = "application_submit") => [
  {
    role: "agent",
    message: agentSays,
    tool_calls: [{ tool_name: tool, params_as_json: JSON.stringify({ fields_json: "{}" }) }],
    tool_results: [{
      tool_name: tool,
      result_value: JSON.stringify({
        needs_confirmation: true,
        confirmation_id: ID,
        readback: rbk,
      }),
    }],
  },
  { role: "user", message: callerSays },
  {
    role: "agent",
    message: "Done.",
    tool_calls: [{
      tool_name: tool,
      params_as_json: JSON.stringify({ fields_json: "{}", confirmation_id: ID }),
    }],
  },
];

Deno.test("K5 (MED-302): read-back said and a clear yes, in English and Swahili", () => {
  assertEquals(readBackResults(call(rbk.en, "Yes, go ahead.")), [
    { tool: "application_submit", ok: true, missing: [], yes: true },
  ]);
  assertEquals(readBackResults(call(`${rbk.sw} Niendelee?`, "Ndio.")), [
    { tool: "application_submit", ok: true, missing: [], yes: true },
  ]);
  // Punctuation and digits for the amount still count.
  assertEquals(
    readBackResults(call("Pay KES 7,550, biometrics on Thursday, 15 October 2026. OK?", "Sawa"))[0]
      .ok,
    true,
  );
});

Deno.test("K5 (MED-302): a missing amount or date, or no yes, is not ok", () => {
  assertEquals(readBackResults(call("Shall I submit it?", "Yes"))[0], {
    tool: "application_submit",
    ok: false,
    missing: ["amount", "date"],
    yes: true,
  });
  assertEquals(readBackResults(call(rbk.en, "Hmm, how much again?"))[0], {
    tool: "application_submit",
    ok: false,
    missing: [],
    yes: false,
  });
  assertEquals(readBackResults(call(rbk.sw, "Hapana, subiri"))[0].yes, false);
});

Deno.test("K5 (MED-302): only a commit with the prepare's id counts; other tools are ignored", () => {
  const t = call(rbk.en, "Yes");
  t[2].tool_calls![0].params_as_json = JSON.stringify({ confirmation_id: "other" });
  assertEquals(readBackResults(t), []);
  assertEquals(readBackResults(call(rbk.en, "Yes", "payment_request")).map((r) => r.tool), [
    "payment_request",
  ]);
  assertEquals(readBackResults([{ role: "user", message: "hello" }]), []);
});

Deno.test("K6 close: spoken English numbers, ordinal days and the window count as said", () => {
  assertEquals(enNumbersToDigits("seven thousand five hundred fifty shillings"), "7550 shillings");
  assertEquals(
    enNumbersToDigits("the twelfth of October twenty twenty-six"),
    "the 12 of october 2026",
  );
  assertEquals(enNumbersToDigits("nine thousand, five hundred and fifty"), "9550");
  // conv_1701 (8 Oct): the read-back spoken by a speech model, words for every number.
  assertEquals(
    readBackResults(call(
      "To confirm: the fee is seven thousand five hundred fifty shillings, biometrics on Thursday, the fifteenth of October twenty twenty-six. Shall I go ahead?",
      "Yes, please.",
    ))[0].ok,
    true,
  );
  // A wrong amount or day is still a miss.
  assertEquals(
    readBackResults(call(
      "The fee is seven thousand five hundred shillings, on the fifteenth of October. OK?",
      "Yes.",
    ))[0].missing,
    ["amount"],
  );
  assertEquals(
    readBackResults(call("The fee is 7,550 shillings, on the sixteenth of October. OK?", "Yes."))[0]
      .missing,
    ["date"],
  );
});
