// A small JSON Schema checker (the subset the Konza profile uses). Validates application fields
// in the core and every response in the contract tests.

import type { JsonSchema } from "./types.ts";

const FORMATS: Record<string, RegExp> = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  date: /^\d{4}-\d{2}-\d{2}$/,
  "date-time": /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/,
};

const typeOf = (v: unknown) =>
  v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v;

/** Returns a list of problems; empty means valid. `resolve` follows $ref. */
export function check(
  schema: JsonSchema,
  value: unknown,
  path = "$",
  resolve: (ref: string) => JsonSchema = () => {
    throw new Error("no $ref resolver");
  },
): string[] {
  if (schema.$ref) return check(resolve(schema.$ref), value, path, resolve);
  const errors: string[] = [];
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const t = typeOf(value);
    if (!types.includes(t) && !(t === "integer" && types.includes("number"))) {
      return [`${path}: expected ${types.join("|")}, got ${t}`];
    }
  }
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: not ${schema.const}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: not one of the allowed values`);
  }
  if (typeof value === "string") {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: bad format`);
    }
    if (schema.format && FORMATS[schema.format] && !FORMATS[schema.format].test(value)) {
      errors.push(`${path}: not a ${schema.format}`);
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: too short`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path}: too long`);
    }
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: below minimum`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path}: above maximum`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: too few items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      return [...errors, `${path}: too many items`];
    }
    if (schema.items) {
      value.forEach((v, i) => errors.push(...check(schema.items!, v, `${path}[${i}]`, resolve)));
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    // Own properties only: "constructor" or "__proto__" are never schema keys (K4, MED-279).
    for (const k of schema.required ?? []) {
      if (!Object.hasOwn(obj, k)) errors.push(`${path}.${k}: missing`);
    }
    for (const [k, v] of Object.entries(obj)) {
      const sub = schema.properties && Object.hasOwn(schema.properties, k)
        ? schema.properties[k]
        : undefined;
      if (sub) errors.push(...check(sub, v, `${path}.${k}`, resolve));
      else if (schema.additionalProperties === false) errors.push(`${path}.${k}: not allowed`);
      else if (typeof schema.additionalProperties === "object") {
        errors.push(...check(schema.additionalProperties, v, `${path}.${k}`, resolve));
      }
    }
  }
  return errors;
}
