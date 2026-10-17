// K8 S5 (MED-335, plan-k8 2.8): what /developers shows, read at build time from the checked copies
// of the spec (web/lib/spec, written by `deno task spec:web`) and the UI catalog (web/lib/ui).
// Pure data, no client code; tests/developers_test.ts keeps the copies equal to the spec.

import catalog from "./ui/catalog.schema.json" with { type: "json" };
import spec from "./spec/openapi.json" with { type: "json" };

export type Charter = "acts_alone" | "asks_first" | "never_acts";
export type Operation = {
  id: string;
  method: string;
  path: string;
  summary: string;
  charter: Charter;
  statuses: string[];
};

type Op = { operationId?: string; summary?: string; "x-konza-charter"?: Charter; responses?: Record<string, unknown>; tags?: string[] };

export const VERSION: string = spec.info.version;
export const TITLE: string = spec.info.title;
export const SUMMARY: string = spec.info.summary;

/** Every operation of the profile, grouped by its first tag, in the spec's order. */
export function operations(): { tag: string; ops: Operation[] }[] {
  const groups = new Map<string, Operation[]>();
  for (const [path, item] of Object.entries(spec.paths as Record<string, Record<string, Op>>)) {
    for (const [method, op] of Object.entries(item)) {
      if (!op?.operationId) continue;
      const tag = op.tags?.[0] ?? "other";
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag)!.push({
        id: op.operationId,
        method: method.toUpperCase(),
        path,
        summary: op.summary ?? "",
        charter: op["x-konza-charter"] ?? "never_acts",
        statuses: Object.keys(op.responses ?? {}),
      });
    }
  }
  const order = (spec.tags as { name: string }[]).map((t) => t.name);
  return [...groups].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b)).map(([tag, ops]) => ({ tag, ops }));
}

/** The charter levels in plain words (the spec's description says the same). */
export const CHARTER: { level: Charter; words: string }[] = [
  {
    level: "acts_alone",
    words: "An assistant may call it without asking the resident first: answers from the rules, a status, the resident's own address.",
  },
  {
    level: "asks_first",
    words: "Two steps. The first call changes nothing and returns 202 with a confirmation and a read-back. The assistant reads it back, gets a clear yes, then repeats the same request with confirmation_id, at least 4 seconds and at most 3 minutes later. Only then does anything happen.",
  },
  {
    level: "never_acts",
    words: "Only an officer credential is accepted. No assistant path exists: officer decisions and desk records.",
  },
];

/** The UI catalog's kinds and what each is for, from catalog.schema.json. */
export function cardKinds(): { kind: string; words: string }[] {
  const defs = catalog.$defs as Record<string, { description?: string }>;
  return (catalog.properties.kind.enum as string[]).map((kind) => ({ kind, words: defs[kind]?.description ?? "" }));
}
export const CATALOG_VERSION = "ui/v1";

/** A small, text-only reading of the changelog's Markdown: headings, bullets and paragraphs.
 * Inline marks are dropped, so nothing in the file is ever rendered as markup. */
export type Block = { kind: "h2" | "h3" | "p" | "li"; text: string };
export function markdownBlocks(md: string): Block[] {
  const plain = (s: string) => s.replace(/\*\*|`/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
  const out: Block[] = [];
  for (const line of md.split(/\r?\n/)) {
    if (!line.trim() || /^# /.test(line)) continue;
    if (/^### /.test(line)) out.push({ kind: "h3", text: plain(line.slice(4)) });
    else if (/^## /.test(line)) out.push({ kind: "h2", text: plain(line.slice(3)) });
    else if (/^- /.test(line)) out.push({ kind: "li", text: plain(line.slice(2)) });
    else out.push({ kind: "p", text: plain(line) });
  }
  return out;
}
