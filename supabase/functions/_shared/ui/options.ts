// K8 S4 (MED-333, plan-k8 2.4): fields that hold an internal id are choices the backend fills on
// the form card, never typed. A Lango Square document is "Handed in at Lango Square" (the core
// finds the record, as SIA's `desk` does); a school comes from the schools list; a business from
// the verified resident's own registrations; and a service that acts for a child (it has a consent
// scope) asks who it is for, from the resident's children on record. Forms that need the
// resident's own records wait for the identity check.

import { db, must } from "../db.ts";
import type { JsonSchema } from "../konza/types.ts";
import type { FormField } from "./catalog.ts";

/** The form field that names the child; the act route passes it as on_behalf_of. */
export const SUBJECT_FIELD = "on_behalf_of";

const DESK = { value: "desk", label: { en: "Handed in at Lango Square", sw: "Niliwasilisha Lango Square" } };

/** True when the form can only be filled from the verified resident's own records. */
export function needsResident(schema: JsonSchema, consentScope: string | null | undefined) {
  return !!consentScope ||
    Object.values(schema.properties ?? {}).some((p) => p["x-konza-options"] === "businesses");
}

/** The fields with their choices, or null when the form cannot be shown yet (not verified) or has
 * nothing to choose from (no child or business on record). */
export async function withOptions(
  fields: FormField[],
  schema: JsonSchema,
  o: { consentScope?: string | null; citizenId: string | null },
): Promise<FormField[] | null> {
  if (needsResident(schema, o.consentScope) && !o.citizenId) return null;
  const out: FormField[] = [];
  for (const f of fields) {
    const source = schema.properties?.[f.name]?.["x-konza-options"];
    if (f.type === "evidence") {
      out.push({ ...f, options: [DESK] });
    } else if (source === "schools") {
      const rows = must(await db.from("schools").select("id, name").order("name").limit(12)) as {
        id: string;
        name: string;
      }[];
      out.push({ ...f, options: rows.map((r) => ({ value: r.id, label: { en: r.name } })) });
    } else if (source === "businesses") {
      const rows = must(
        await db.from("konza_applications").select("id, ref, fields").eq("agency", "sco")
          .eq("service", "business_registration").eq("applicant_citizen_id", o.citizenId!)
          .eq("status", "decided").order("created_at", { ascending: false }).limit(12),
      ) as { id: string; ref: string; fields: Record<string, unknown> }[];
      const granted = new Set(
        (must(
          await db.from("konza_decisions").select("application_id").eq("outcome", "granted")
            .in("application_id", rows.map((r) => r.id)),
        ) as { application_id: string }[]).map((d) => d.application_id),
      );
      const options = rows.filter((r) => granted.has(r.id))
        .map((r) => ({ value: r.ref, label: { en: String(r.fields?.name ?? r.ref) } }));
      if (!options.length) return null;
      out.push({ ...f, options });
    } else out.push(f);
  }
  if (o.consentScope) {
    const links = must(
      await db.from("guardianships").select("child_citizen_id").eq("guardian_citizen_id", o.citizenId!),
    ) as { child_citizen_id: string }[];
    const kids = links.length
      ? must(
        await db.from("citizens").select("resident_number, full_name")
          .in("id", links.map((l) => l.child_citizen_id)).order("full_name"),
      ) as { resident_number: string | null; full_name: string }[]
      : [];
    // First names only (the cards and Savannah speak of a child by first name).
    const options = kids.flatMap((k) =>
      k.resident_number ? [{ value: k.resident_number, label: { en: k.full_name.split(" ")[0] } }] : []
    );
    if (!options.length) return null;
    out.unshift({
      name: SUBJECT_FIELD,
      type: "string",
      label: { en: "Who is this for", sw: "Ni kwa ajili ya nani" },
      required: true,
      options,
    });
  }
  return out;
}
