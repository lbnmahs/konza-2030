import { assertEquals } from "jsr:@std/assert@1";
import { filterFields, maskPhone } from "./partners.ts";

const allowed = ["certificate_number", "start_date"];
const available = {
  full_name: "Test Person",
  certificate_number: "CERT-1",
  start_date: "2026-10-01",
  disability: "must never leave",
};

Deno.test("only allowed fields are sent; the rest are stripped", () => {
  const r = filterFields(
    ["certificate_number", "start_date", "full_name", "disability"],
    allowed,
    available,
  );
  assertEquals(r.sent, { certificate_number: "CERT-1", start_date: "2026-10-01" });
  assertEquals(r.stripped, ["full_name", "disability"]);
});

Deno.test("allowed but missing values are reported, not invented", () => {
  const r = filterFields(["start_date"], allowed, { certificate_number: "CERT-1" });
  assertEquals(r.sent, {});
  assertEquals(r.unavailable, ["start_date"]);
});

Deno.test("duplicates and blanks are ignored", () => {
  assertEquals(filterFields(["start_date", " start_date ", ""], allowed, available).sent, {
    start_date: "2026-10-01",
  });
});

Deno.test("phone numbers are masked", () => {
  assertEquals(maskPhone("+44 7700 900123"), "••• 123");
});

import { codeTwiml } from "./voice.ts";

Deno.test("voice code: digits separated, said twice, says demo", () => {
  const t = codeTwiml("Northfield Borough Council", "427913");
  assertEquals(t.match(/4, 2, 7, 9, 1, 3/g)?.length, 2);
  assertEquals(t.includes("demo"), true);
});

Deno.test("plain SMS for screen readers: no bullets or pound signs", async () => {
  const { plainText } = await import("./util.ts");
  assertEquals(
    plainText("Council tax account ••••8273: next instalment £196.80, then £70.00."),
    "Council tax account ending 8273: next instalment 196 pounds 80, then 70 pounds.",
  );
});
