import { assertEquals } from "jsr:@std/assert@1";
import { languageSwitches } from "./language.ts";

const detect = (language: string, secs: number) => ({
  role: "agent",
  time_in_call_secs: secs,
  tool_calls: [{ tool_name: "language_detection", params_as_json: JSON.stringify({ language }) }],
});

Deno.test("language switches come from language_detection calls in order", () => {
  const transcript = [
    { role: "agent", time_in_call_secs: 0, tool_calls: [] },
    detect("en", 22),
    { role: "user", time_in_call_secs: 29 },
    detect("sw", 33),
  ];
  assertEquals(languageSwitches(transcript, "ar"), [
    { from: "ar", to: "en", atSecs: 22 },
    { from: "en", to: "sw", atSecs: 33 },
  ]);
});

Deno.test("detecting the current language is not a switch", () => {
  assertEquals(languageSwitches([detect("sw", 1)], "sw"), []);
  assertEquals(languageSwitches([], "en"), []);
});

Deno.test("bad tool params are skipped", () => {
  const bad = {
    time_in_call_secs: 5,
    tool_calls: [{ tool_name: "language_detection", params_as_json: "{" }],
  };
  assertEquals(languageSwitches([bad, detect("en", 9)], "ar"), [{
    from: "ar",
    to: "en",
    atSecs: 9,
  }]);
});
