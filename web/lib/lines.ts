// The conversation's lines as the resident sees them: a reply streams in parts, each
// part shown as it arrives, and the finished line from the SDK then settles it without a second
// copy. Pure and without imports, so the Deno tests check it (tests/ui_test.ts).

/** note: a finished card's one line, left when a newer card replaces it (MED-332). */
export type Caption = { role: "user" | "agent" | "note"; text: string; parts?: string[]; streaming?: boolean };
export type Part = { type: "start" | "delta" | "stop"; text: string };

/** One streamed part. A reply opens with its first words, not its start: before a tool call the
 * agent sends a start and a stop with no words, which must not show as an empty "Savannah:" line.
 * A delta adds to the open reply; a stop changes nothing (the finished line settles
 * it). */
export function addPart(lines: Caption[], part: Part): Caption[] {
  if (part.type !== "delta" || !part.text) return lines;
  const last = lines.at(-1);
  const open = last?.role === "agent" && last.streaming ? last : undefined;
  if (!open) return [...lines, { role: "agent", text: part.text, parts: [part.text], streaming: true }];
  const parts = [...(open.parts ?? []), part.text];
  return [...lines.slice(0, -1), { ...open, text: parts.join(""), parts }];
}

/** A finished line. An agent line settles the reply that streamed it; the parts stay only when they
 * spell the same words, so a corrected reply shows as the agent finally said it. */
export function addLine(lines: Caption[], line: Caption): Caption[] {
  const i = lines.findLastIndex((l) => l.role === "agent" && l.streaming);
  if (line.role !== "agent" || i < 0) return [...lines, line];
  const same = lines[i].parts?.join("").trim() === line.text.trim();
  const settled: Caption = { role: "agent", text: line.text, ...(same ? { parts: lines[i].parts } : {}) };
  return [...lines.slice(0, i), settled, ...lines.slice(i + 1)];
}
