// K8 (MED-327): the UI catalog ui/v1 (spec/konza-2030-api/ui/catalog.schema.json). The backend
// emits these events after a tool result; the model never writes UI. Events are checked with the
// profile's own JSON Schema subset: the envelope first, then the payload against $defs[kind]. The
// subset ignores allOf and if/then, so the schema's cross-field rules are also written out here
// (CHARTER_RULES); a unit test runs a full 2020-12 validator over the same cases.

import { check } from "../konza/schema.ts";
import type { JsonSchema } from "../konza/types.ts";

export const UI_VERSION = "ui/v1";
/** Same as konza/evidence.ts (which opens a database client on import; a test keeps them equal). */
export const EVIDENCE_PATTERN = "^desk(:[0-9a-f-]{36})?$";

export type Catalog = JsonSchema & { $defs: Record<string, JsonSchema> };
export type Text = { en: string; sw?: string };
export type UiEvent = { v: string; seq: number; kind: string; at: string; payload: unknown };

/** Problems with one event; empty means it may be stored and shown. Unknown kinds are refused. */
export function checkEvent(catalog: Catalog, ev: unknown): string[] {
  const resolve = (ref: string) => {
    const m = ref.match(/^#\/\$defs\/(\w+)$/);
    if (!m || !Object.hasOwn(catalog.$defs, m[1])) throw new Error(`unknown $ref ${ref}`);
    return catalog.$defs[m[1]];
  };
  const errors = check(catalog, ev, "$", resolve);
  if (errors.length) return errors;
  const { kind, payload } = ev as UiEvent;
  const problems = check(catalog.$defs[kind], payload, "$.payload", resolve);
  return problems.length ? problems : (CHARTER_RULES[kind]?.(payload as any) ?? []);
}

/** The schema's allOf rules, as code. Charter 2: an adverse outcome is only ever an officer's, a
 * pending decision has no decider yet, and a rule decision names its rules. */
const CHARTER_RULES: Record<string, (p: any) => string[]> = {
  receipt: (p) => [
    ...(["refused", "offered_alternative"].includes(p.outcome) && p.decided_by !== "officer"
      ? ["$.payload: an adverse outcome is decided by an officer"]
      : []),
    ...((p.outcome === "pending_officer") !== (p.decided_by === "pending")
      ? ["$.payload: pending_officer goes with decided_by pending, and only then"]
      : []),
    ...(p.decided_by === "rule" && !p.rule_ids?.length
      ? ["$.payload: a rule decision names its rules"]
      : []),
  ],
};

const LABEL_KEYS = ["title", "x-konza-title-sw", "x-konza-enum-en", "x-konza-enum-sw", "x-konza-options"];

/** A schema without its screen labels. SIA's service_open result stays as it was before K8, so
 * labels (and unreviewed Swahili) never change the live agent's context through a backend deploy. */
export function withoutLabels(schema: JsonSchema): JsonSchema {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (LABEL_KEYS.includes(k)) continue;
    if (k === "properties" && v) {
      out[k] = Object.fromEntries(
        Object.entries(v as Record<string, JsonSchema>).map(([n, p]) => [n, withoutLabels(p)]),
      );
    } else if (k === "items" && v) out[k] = withoutLabels(v as JsonSchema);
    else out[k] = v;
  }
  return out as JsonSchema;
}

export type FormField = {
  name: string;
  type: "integer" | "string" | "boolean" | "evidence";
  label: Text;
  required: boolean;
  multiple?: boolean;
  options?: { value: string | number; label: Text }[];
};

/** The form card's fields, built from a service's applicationSchema and its label annotations,
 * never by hand per service. Throws on a field with no label, so a new agency cannot ship one. */
export function formFields(schema: JsonSchema): FormField[] {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, p]) => {
    if (!p.title) throw new Error(`field ${name} has no title`);
    const label: Text = { en: p.title, ...(p["x-konza-title-sw"] ? { sw: p["x-konza-title-sw"] } : {}) };
    const evidence = (s: JsonSchema | undefined) => s?.pattern === EVIDENCE_PATTERN;
    if (evidence(p) || (p.type === "array" && evidence(p.items))) {
      return {
        name,
        type: "evidence",
        label,
        required: required.has(name),
        ...(p.type === "array" ? { multiple: true } : {}),
      };
    }
    const type = p.type as FormField["type"];
    if (!["integer", "string", "boolean"].includes(type)) {
      throw new Error(`field ${name}: type ${p.type} has no form control`);
    }
    const field: FormField = { name, type, label, required: required.has(name) };
    if (p.enum) {
      const en = p["x-konza-enum-en"], sw = p["x-konza-enum-sw"];
      if (en?.length !== p.enum.length) throw new Error(`field ${name}: enum labels missing`);
      field.options = p.enum.map((value, i) => ({
        value: value as string | number,
        label: { en: en[i], ...(sw?.[i] ? { sw: sw[i] } : {}) },
      }));
    }
    return field;
  });
}
