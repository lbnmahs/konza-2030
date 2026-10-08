import { assertEquals } from "jsr:@std/assert@1";
import { check } from "./schema.ts";

Deno.test("K4 (MED-279): prototype names are never schema keys", () => {
  const schema = {
    type: "object",
    required: ["a"],
    additionalProperties: false,
    properties: { a: { type: "string" } },
  };
  for (const k of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    const v = JSON.parse(`{"a":"x",${JSON.stringify(k)}:"y"}`);
    assertEquals(check(schema, v), [`$.${k}: not allowed`], k);
  }
  assertEquals(check({ ...schema, required: ["toString"] }, { a: "x" }), ["$.toString: missing"]);
});

Deno.test("K3: maxItems caps arrays before their items are checked", () => {
  const schema = { type: "array", maxItems: 2, items: { type: "string" } };
  assertEquals(check(schema, ["a", "b"]), []);
  assertEquals(check(schema, ["a", "b", "c"]), ["$: too many items"]);
});
