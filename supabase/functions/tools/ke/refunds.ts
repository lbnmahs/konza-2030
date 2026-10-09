// Kenya refund policies (P13). Fictional, modelled rules; outcomes in rules/common/refunds.ts.
// Usajili Njema: the ID replacement fee is refundable until biometrics are booked (conv_1901:
//   the old ID turned up after payment). Reactivating a blocked card is never done by phone.
// Pwani Njema: the permit fee pays for the permit, so it has started once the permit is issued.
// Tiba Njema: a contribution has started once it is recorded against the month.

import { db, must } from "../../_shared/db.ts";
import { registerRefund } from "../common/refunds.ts";

registerRefund("usajili_njema", {
  refundable: true,
  serviceStarted: async (pay) =>
    must(
      await db.from("registry_bookings").select("id").eq("case_ref", pay.case_ref).limit(1),
    ).length > 0,
});

registerRefund("pwani_njema", {
  refundable: true,
  serviceStarted: async (pay) =>
    must(
      await db.from("county_permits").select("id").eq("renewed_payment_id", pay.id).limit(1),
    ).length > 0,
});

registerRefund("tiba_njema", {
  refundable: true,
  serviceStarted: async (pay) =>
    must(
      await db.from("health_contributions").select("id").eq("payment_id", pay.id).limit(1),
    ).length > 0,
});
