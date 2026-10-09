// Savanahlands Institute of Learning and Nurturing (SILN): primary school places (ED-01 to
// ED-06). A parent or guardian applies for a child with recorded consent (ED-02, DPA s33).

import { db, must } from "../../db.ts";
import { allocate, placesLeft, primaryAgeOk, type School } from "../../rules/konza/rules.ts";
import { checkEvidence } from "../evidence.ts";
import { myApplication } from "../status.ts";
import type { Agency, Resident } from "../types.ts";
import { rb, readBack } from "../../readback.ts";

const allSchools = async () => must(await db.from("schools").select("*").order("id")) as School[];

async function zoneOf(r: Resident): Promise<number | null> {
  const a = must(await db.from("addresses").select("zone").eq("citizen_id", r.id).maybeSingle());
  return a?.zone ?? null;
}

export const siln: Agency = {
  id: "siln",
  name: "Savanahlands Institute of Learning and Nurturing",
  authority: "siln",
  services: {
    primary_place: {
      title: "Primary school place",
      card: [
        "School places are free and go by catchment first, then distance, then space (rules_lookup topic eligibility).",
        "A returning caller: rules_lookup topic my_application gives their application (or their child's), the decision and its reason, any fee still owed, and delivery.",
        "Verify the parent. The parent must be the child's recorded parent or guardian and give consent for SIA to apply for the child (consent_record, scope school_application).",
        "rules_lookup topic schools shows the schools in the child's zone and places left.",
        "application_submit with on_behalf_of the child and field preferred_school_id; read back, clear yes, then again with the confirmation_id.",
        "If the preferred school is full or outside the zone, an officer confirms an offer: say that, the alternative proposed, and when. Never say the child was refused.",
      ].join("\n"),
      topics: {
        my_application: myApplication("siln", "primary_place", "school place application"),
        eligibility: {
          needsResident: false,
          answer: () =>
            Promise.resolve({
              topic: "eligibility",
              values: {
                free: true,
                ages: [5, 13],
                documents: ["birth certificate", "immunisation card"],
              },
              rule_ids: ["ED-01", "ED-02", "ED-06"],
              reason_en:
                "Public primary places are free for children aged 5 to 13. A parent or guardian applies with the birth certificate and immunisation card.",
            }),
        },
        schools: {
          needsResident: false,
          answer: async (r, inputs) => {
            const zone = Number(inputs.zone) || (r ? await zoneOf(r) : null);
            if (!zone) {
              return {
                topic: "schools",
                values: { schools: [] },
                rule_ids: ["ED-03"],
                reason_en:
                  "Say which zone, or verify the caller so their registered address is used.",
              };
            }
            const schools = (await allSchools()).filter((s) => s.zone === zone)
              .map((s) => ({ id: s.id, name: s.name, zone: s.zone, places_left: placesLeft(s) }));
            return {
              topic: "schools",
              values: { zone, schools },
              rule_ids: ["ED-03"],
              reason_en:
                `Schools in zone ${zone}, with places left. Places go to children in the zone first; for a school outside the zone or one that is full, an officer confirms an offer, and any decision can be reviewed.`,
            };
          },
        },
      },
      applicationSchema: {
        type: "object",
        required: ["preferred_school_id"],
        additionalProperties: false,
        properties: {
          preferred_school_id: { type: "string", pattern: "^[a-z0-9_]{1,40}$" },
          // ED-02 (K3): the birth certificate and immunisation card, as Lango Square desk records. Without them the place is still decided; they are brought on day one.
          documents: {
            type: "array",
            maxItems: 2,
            items: { type: "string", pattern: "^desk(:[0-9a-f-]{36})?$" },
          },
        },
      },
      consentScope: "school_application",
      summarize: (f, subject) =>
        readBack(
          {
            child: rb.name(subject.full_name.split(" ")[0]),
            school: rb.place(String(f.preferred_school_id)),
          },
          (s) => `Apply for a primary school place for ${s.child} at school ${s.school}.`,
          (s) => `Kuomba nafasi ya shule ya msingi kwa ${s.child} katika shule ${s.school}.`,
        ),
      decide: async ({ subject, applicant, fields, today }) => {
        // ED-02: documents given now must be this child's, of the right kind.
        const docs = Array.isArray(fields.documents) ? fields.documents.map(String) : [];
        for (const d of docs) {
          await checkEvidence(d, subject.id, ["birth_certificate", "immunisation_card"]);
        }
        if (!primaryAgeOk(subject.dob, today)) {
          return {
            outcome: "pending_officer",
            rule_ids: ["ED-06"],
            reason_en:
              "Primary places are for ages 5 to 13, so an officer will look at this application.",
            inputs: {},
          };
        }
        const zone = (await zoneOf(subject)) ?? (await zoneOf(applicant));
        const schools = await allSchools();
        const r = allocate(String(fields.preferred_school_id), zone ?? 0, schools);
        if (r.outcome === "granted") {
          // The alternative is recorded too, so an officer can still offer it if the grant is
          // held or cannot take effect (K4, MED-280).
          const alt = allocate("", zone ?? 0, schools.filter((s) => s.id !== r.school.id));
          return {
            outcome: "granted",
            rule_ids: [...r.rule_ids, "ED-06"],
            reason_en:
              `A place is confirmed at ${r.school.name}: it is in the child's zone and has space.`,
            inputs: {
              zone,
              school_id: r.school.id,
              alternative_school_id: alt.outcome === "pending_officer"
                ? alt.alternative?.id ?? null
                : null,
            },
            next_en: "Bring the birth certificate and immunisation card on the first day.",
          };
        }
        const why = r.why === "full"
          ? "The preferred school is full"
          : r.why === "outside_catchment"
          ? "The preferred school is outside the child's zone"
          : "That school is not on our list";
        return {
          outcome: "pending_officer",
          rule_ids: r.rule_ids,
          reason_en: `${why}, so an officer will confirm an offer${
            r.alternative ? ` (proposed: ${r.alternative.name})` : ""
          } within 5 working days.`,
          inputs: { zone, alternative_school_id: r.alternative?.id ?? null },
        };
      },
      onGranted: async (fields, inputs, outcome) => {
        // A rule grant takes the school it checked; an officer grants the preferred school or
        // offers the proposed alternative.
        const id = String(
          outcome === "offered_alternative"
            ? inputs.alternative_school_id ?? ""
            : inputs.school_id ?? fields.preferred_school_id ?? "",
        );
        if (!id) return false;
        return must(await db.rpc("take_school_place", { school: id })) === true;
      },
      onUndo: async (fields, inputs, outcome) => {
        const id = String(
          outcome === "offered_alternative"
            ? inputs.alternative_school_id ?? ""
            : inputs.school_id ?? fields.preferred_school_id ?? "",
        );
        if (id) must(await db.rpc("release_school_place", { school: id }));
      },
    },
  },
};
