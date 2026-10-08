import { assert, assertEquals } from "jsr:@std/assert@1";
import { leftovers, redactText, redactTranscript } from "./redact.ts";

Deno.test("K6 (MED-307): references, codes, resident numbers and phone endings go; rules stay", () => {
  const t = redactText(
    "Ref SPS-61D7396E, txn KZP055A010, resident QK20410039 or QK-2041-0039, code 482 913, " +
      "phone +44 7700 900123, ending in 878, inayoishia na nane saba nane. Rule PP-02, " +
      "fee 12,050 shillings on 2026-10-12, sitini na sita, tarehe kumi na mbili, mwaka elfu mbili. " +
      "My date of birth ni 12 April 1987; tarehe ya kuzaliwa 1987-04-12.",
  );
  assert(!/1987/.test(t), t);
  const more = redactText("I was born 20 June 1990. Namba ya kodi, QK-T-mbili-mbili... samahani.");
  assert(!/1990|mbili-mbili/.test(more), more);
  for (
    const gone of ["61D7396E", "KZP055A010", "20410039", "2041-0039", "482 913", "900123", "878"]
  ) {
    assert(!t.includes(gone), `${gone} left in: ${t}`);
  }
  assert(!/nane saba nane/.test(t), t);
  for (const kept of ["PP-02", "12,050", "2026-10-12", "sitini na sita", "elfu mbili"]) {
    assert(t.includes(kept), `${kept} lost: ${t}`);
  }
});

Deno.test("K6 (MED-307): a spoken code in the code window is dropped; tool fields are allowlisted", () => {
  const turns = redactTranscript([
    { role: "agent", message: "Hello, I'm Savannah, an AI assistant." },
    {
      role: "agent",
      tool_calls: [{
        tool_name: "identity_start_otp",
        params_as_json: '{"id_number":"QK20410039"}',
      }],
      tool_results: [{
        tool_name: "identity_start_otp",
        result_value: '{"verification_id":"25523f0b-b1f6","phone_last3":"878","code_sent":true}',
      }],
    },
    { role: "user", message: "four eight two nine one three" },
    {
      role: "agent",
      tool_calls: [{ tool_name: "identity_check_otp", params_as_json: '{"code":"482913"}' }],
      tool_results: [{ tool_name: "identity_check_otp", result_value: '{"verified":true}' }],
    },
    {
      role: "agent",
      tool_results: [{
        tool_name: "application_submit",
        result_value:
          '{"ref":"SPS-61D7396E","outcome":"granted","rule_ids":["PP-02"],"readback":{"sw":"ada shilingi elfu kumi na mbili na hamsini"}}',
      }],
    },
    { role: "user", message: "Ndio, four eight two" },
  ]);
  assertEquals(turns[2].text, "[code read aloud, redacted]");
  assertEquals(turns[1].calls![0].args, {});
  assertEquals(turns[1].results![0].value, { code_sent: true });
  assertEquals(turns[3].calls![0].args, {});
  assertEquals(turns[4].results![0].value, {
    outcome: "granted",
    rule_ids: ["PP-02"],
    readback: { sw: "ada shilingi elfu kumi na mbili na hamsini" },
  });
  // After the window closes, three digit words are speech, not a code.
  assertEquals(turns[5].text, "Ndio, four eight two");
  assertEquals(leftovers(turns), []);
  assertEquals(leftovers([{ i: 0, at: 0, role: "user", text: "my code is 123456" }]), ["123456"]);
});

Deno.test("K6 (MED-307): results a check needs survive; identifiers inside them go", () => {
  const [t] = redactTranscript([{
    role: "agent",
    tool_results: [
      {
        tool_name: "create_case",
        result_value: '{"case_created":true,"officer_will_call_back":true,"case_id":"c-1"}',
      },
      {
        tool_name: "rules_lookup",
        result_value:
          '{"topic":"cover_status","values":{"active":false,"month":"2026-10","minimum_kes":300}}',
      },
    ],
  }]);
  assertEquals(t.results![0].value, { case_created: true, officer_will_call_back: true });
  assertEquals(t.results![1].value, {
    topic: "cover_status",
    values: { active: false, month: "2026-10", minimum_kes: 300 },
  });
});

Deno.test("K6 security review: nested JSON, more keys, ids, dates and comma codes are redacted", () => {
  const [t] = redactTranscript([{
    role: "agent",
    tool_calls: [{
      tool_name: "application_submit",
      params_as_json: JSON.stringify({
        fields_json:
          '{"name":"Amani Njoroge","dob":"2019-03-02","evidence":"desk:6b5f2027-0000-4000-8000-0000000000e1","pages":34}',
      }),
    }, {
      tool_name: "health_add_dependant",
      params_as_json: '{"dependant_name":"Amani","dependant_dob":"2019-03-02","window":"morning"}',
    }],
  }]);
  assertEquals(t.calls![0].args, { fields_json: { pages: 34 } });
  assertEquals(t.calls![1].args, { window: "morning" });
  const text = redactText(
    "Evidence desk:6b5f2027-0000-4000-8000-0000000000e1, id 6b5f2027-0000-4000-8000-0000000000e1, " +
      "born April 12, 1987, born 12/04/1987, code 4, 8, 2, 9, 1, 3.",
  );
  for (const gone of ["6b5f", "1987", "4, 8, 2"]) assert(!text.includes(gone), text);
  assertEquals(
    leftovers([{ i: 0, at: 0, role: "user", text: "desk:6b5f2027 e1 12/04/1987" }]).length,
    2,
  );
});
