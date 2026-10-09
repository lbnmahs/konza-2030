// Refund rules (P13 D5). Fictional, modelled rules shared by every authority; each authority
// says whether its fees can be refunded at all and when its service counts as started.
// RF-01 a duplicate payment for the same case is refunded.
// RF-02 a fee marked non-refundable is never refunded (apart from duplicates).
// RF-03 once the service has started (permit issued, cover recorded, biometrics booked) the fee
//       is not refunded by phone.
// RF-04 within 14 days of payment, before the service starts, the fee is refunded.
// RF-05 anything else goes to an officer.

export const REFUND_WINDOW_DAYS = 14;

export type RefundInput = {
  duplicate: boolean;
  refundable: boolean;
  serviceStarted: boolean;
  daysSincePayment: number;
};

export type RefundDecision = {
  outcome: "approved" | "declined" | "routed";
  rule_id: string;
  reason_en: string;
};

export function refundDecision(i: RefundInput): RefundDecision {
  if (i.duplicate) {
    return { outcome: "approved", rule_id: "RF-01", reason_en: "This payment was made twice." };
  }
  if (!i.refundable) {
    return { outcome: "declined", rule_id: "RF-02", reason_en: "This fee cannot be refunded." };
  }
  if (i.serviceStarted) {
    return {
      outcome: "declined",
      rule_id: "RF-03",
      reason_en: "The service this fee paid for has already started.",
    };
  }
  if (i.daysSincePayment <= REFUND_WINDOW_DAYS) {
    return {
      outcome: "approved",
      rule_id: "RF-04",
      reason_en: `Paid within ${REFUND_WINDOW_DAYS} days and the service has not started.`,
    };
  }
  return {
    outcome: "routed",
    rule_id: "RF-05",
    reason_en: "An officer needs to review this request.",
  };
}
