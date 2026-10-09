import { assertEquals } from "jsr:@std/assert@1";

Deno.env.set("SUPABASE_URL", Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:1");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "unused");
const { dbInputError } = await import("./core.ts");

Deno.test("K3 (MED-286): Postgres 22xxx is 400, 23xxx is 409, anything else is not input", () => {
  const as = (code: string) => dbInputError(Object.assign(new Error("x"), { code }));
  assertEquals([as("22P02")?.status, as("22P02")?.code], [400, "invalid_input"]);
  assertEquals([as("23505")?.status, as("23505")?.code], [409, "conflict"]);
  assertEquals(as("PGRST116"), null);
  assertEquals(as("08006"), null);
  assertEquals(dbInputError(new Error("no code")), null);
});
