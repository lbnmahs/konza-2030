// Evidence for Konza applications and consents (K3, DK-01): a paper document an officer recorded
// at Lango Square. `desk:<id>` names one record; `desk` alone means the person's latest accepted
// record of the right kind (so nobody reads an id aloud). Either way it must be about this person,
// of an accepted kind, and accepted by the officer. Uploads are not evidence yet (MED-296: SIA has
// no upload path, and an upload was bound to a call rather than to a person).

import { db, must } from "../db.ts";
import { isUuid } from "../util.ts";
import { KonzaError } from "./types.ts";

export const EVIDENCE_PATTERN = "^desk(:[0-9a-f-]{36})?$";

export async function checkEvidence(evidence: string, citizenId: string, types: string[]) {
  const [kind, id] = evidence.split(":");
  let doc: any = null;
  if (kind === "desk" && id === undefined) {
    doc = must(
      await db.from("desk_documents").select("*").eq("citizen_id", citizenId)
        .in("doc_type", types).eq("result", "accepted").order("created_at", { ascending: false })
        .limit(1),
    )[0] ?? null;
  } else if (kind === "desk" && isUuid(id ?? "")) {
    doc = must(await db.from("desk_documents").select("*").eq("id", id).maybeSingle());
  }
  if (doc && doc.citizen_id === citizenId && types.includes(doc.doc_type)) {
    if (doc.result !== "accepted") {
      throw new KonzaError(409, "evidence_rejected", "The officer did not accept that document.");
    }
    return { kind: "desk", type: doc.doc_type as string, id: doc.id as string };
  }
  throw new KonzaError(
    403,
    "evidence_not_valid",
    "No accepted desk document of that kind for this person. They can hand it in at Lango Square.",
  );
}
