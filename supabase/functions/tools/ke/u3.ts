// U3-KE: Usajili Njema, lost national ID. Block the old card first (ID-01), then the fee
// (ID-02), the new photo (ID-03) and an in-person biometrics slot (ID-04). The shared lost-ID
// tools live in common/id_replacement.ts; this file supplies Kenya's rules and the booking.

import { canBookBiometrics, idReplacement, lossDateValid } from "../../_shared/rules/ke/id.ts";
import { swDayMonth, swShillings } from "../../_shared/sw.ts";
import {
  applicationOnCall,
  feePaid,
  photoReceived,
  refuseHandover,
  registerIdReplacement,
} from "../common/id_replacement.ts";
import { registerBooking } from "../common/registry.ts";

const AUTHORITY = "usajili_njema";

registerIdReplacement(AUTHORITY, {
  prefix: "UN",
  payee: "Usajili Njema",
  rules: {
    block: "ID-01",
    fee: "ID-02",
    photo: "ID-03",
    lossDateValid,
    replacement: () => {
      const r = idReplacement();
      return { fee: r.fee_kes, steps: r.steps, rule_ids: r.rule_ids };
    },
  },
  feeFields: (fee) => ({ fee_kes: fee, fee_spoken_sw: swShillings(fee) }),
  dateFields: (prefix, d) => ({ [`${prefix}_sw`]: swDayMonth(d) }),
  amountArg: "amount_kes",
});

registerBooking(AUTHORITY, {
  service: "id_biometrics",
  refPrefix: "UN-BIO",
  rule_ids: ["ID-03", "ID-04"],
  caseRef: async ({ conversationId }, citizen) =>
    (await applicationOnCall(conversationId, citizen)).ref,
  check: async ({ conversationId, agent }, _citizen, caseRef) => {
    const r = canBookBiometrics({
      paid: await feePaid(conversationId, caseRef),
      photoReceived: await photoReceived(conversationId, caseRef),
    });
    if (!r.ok) await refuseHandover(conversationId, agent, r.rule_id, r.reason_en);
  },
});
