/** One language change during a call, taken from the post-call transcript. */
export type LanguageSwitch = { from: string; to: string; atSecs: number };

/** The agent calls language_detection before every switch. Reading those calls after the call
 * keeps the switch itself free of a backend round trip. */
export function languageSwitches(
  transcript: Array<Record<string, any>>,
  startLang: string,
): LanguageSwitch[] {
  const out: LanguageSwitch[] = [];
  let current = startLang;
  for (const turn of transcript ?? []) {
    for (const call of turn.tool_calls ?? []) {
      if (call.tool_name !== "language_detection") continue;
      let lang = "";
      try {
        lang = String(JSON.parse(call.params_as_json ?? "{}").language ?? "");
      } catch {
        continue;
      }
      lang = lang.toLowerCase().slice(0, 2);
      if (!lang || lang === current) continue;
      out.push({ from: current, to: lang, atSecs: Number(turn.time_in_call_secs ?? 0) });
      current = lang;
    }
  }
  return out;
}
