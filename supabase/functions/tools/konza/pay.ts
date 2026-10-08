// K3 (PY-01, MED-282): SIA's fees. The open service (service_open) and the resident's newest
// granted application decide the amount through the agency's charge resolver; the caller pays by
// a code sent to the phone on file, which needs no smartphone.

import { db, must, ToolError } from "../../_shared/db.ts";
import * as core from "../../_shared/konza/core.ts";
import { AGENCIES } from "../../_shared/konza/manifest.ts";
import type { Resident } from "../../_shared/konza/types.ts";
import { swShillings } from "../../_shared/sw.ts";
import { str } from "../../_shared/util.ts";
import { registerCharge } from "../common/payments.ts";

// Once a service is open the gate acts as its agency, so every Konza agency gets the resolver.
const resolver: Parameters<typeof registerCharge>[1] = {
  rulesTool: "rules_lookup",
  phoneCode: true,
  nextOnApproved:
    "Payment received. Say the amount and the transaction code, then continue with the next step on the service card.",
  // MED-296: the amount is still owed on exactly this reference when the code is given.
  stillOwed: async (caseRef, amount) => (await core.chargeForRef(caseRef))?.amount_kes === amount,
  resolve: async ({ conversationId, args }, citizen) => {
    const conv = must(
      await db.from("conversations").select("capability").eq("id", conversationId).single(),
    );
    const [agency, service] = String(conv.capability ?? "").split(".");
    if (!agency || !service) {
      throw new ToolError("no_service", "Open a service first (service_open).");
    }
    // The resident may name the reference to pay; otherwise the newest unpaid one is charged.
    const ref = str(args.reference).toUpperCase();
    const c = (citizen as Resident).resident_number
      ? await core.openCharge(
        citizen as Resident,
        agency,
        service,
        /^[A-Z]{3,4}-[A-F0-9]{8}$/.test(ref) ? ref : undefined,
      )
      : null;
    if (!c) {
      throw new ToolError("nothing_to_pay", "There is no fee to pay on this service right now.");
    }
    return {
      case_ref: c.application.ref,
      amount: c.amount_kes,
      payee: c.agency.name,
      description: c.description,
      reference: c.application.ref,
      rule_ids: ["PY-01", ...c.rule_ids],
      say: { amount_kes: c.amount_kes, amount_spoken_sw: swShillings(c.amount_kes) },
    };
  },
};
for (const a of Object.values(AGENCIES)) registerCharge(a.authority, resolver);
