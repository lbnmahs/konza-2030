// Scenario 3 rules (fictional, Pwani Njema County Government).
// PN-01 renewal opens 30 days before expiry.
// PN-02 small trader market stall: permit fee KES 3,000 + market levy KES 500.
// PN-03 after expiry, 10% penalty (of the permit fee) per started month.
// PN-04 unpaid arrears block renewal and route to an officer.
// PN-05 new validity = old expiry + 12 months.

import { addDays, addMonths, type ISODate } from "../common/dates.ts";

export const FEES: Record<string, { permit: number; levy: number }> = {
  small_trader_market_stall: { permit: 3000, levy: 500 },
};

export type FeeLine = { code: string; label_en: string; label_sw: string; amount_kes: number };

export type RenewalQuote =
  | {
    eligible: true;
    fee_lines: FeeLine[];
    total_kes: number;
    new_expiry: ISODate;
    ruleIds: string[];
  }
  | {
    eligible: false;
    blocked: boolean;
    reason_en: string;
    reason_sw: string;
    opens_on?: ISODate;
    ruleIds: string[];
  };

/** Months started since expiry: the day after expiry starts month 1. */
export function startedMonthsSince(expires: ISODate, today: ISODate): number {
  if (today <= expires) return 0;
  let months = 1;
  while (addMonths(expires, months) < today) months++;
  return months;
}

export function calculateRenewal(p: {
  category: string;
  expires: ISODate;
  arrears_kes: number;
  today: ISODate;
}): RenewalQuote {
  if (p.arrears_kes > 0) {
    return {
      eligible: false,
      blocked: true,
      reason_en:
        `There are unpaid arrears of KES ${p.arrears_kes}. Renewal is blocked until an officer resolves them.`,
      reason_sw:
        `Kuna deni la KES ${p.arrears_kes} ambalo halijalipwa. Permit haiwezi kusasishwa hadi afisa alishughulikie.`,
      ruleIds: ["PN-04"],
    };
  }
  const fees = FEES[p.category];
  if (!fees) {
    return {
      eligible: false,
      blocked: true,
      reason_en: "This permit category cannot be renewed by phone.",
      reason_sw: "Aina hii ya permit haiwezi kusasishwa kwa simu.",
      ruleIds: ["PN-02"],
    };
  }
  const opens = addDays(p.expires, -30);
  if (p.today < opens) {
    return {
      eligible: false,
      blocked: false,
      reason_en: "Renewal opens 30 days before the permit expires.",
      reason_sw: "Usasishaji unafunguliwa siku 30 kabla permit kuisha.",
      opens_on: opens,
      ruleIds: ["PN-01"],
    };
  }

  const lines: FeeLine[] = [
    { code: "PN-02", label_en: "Permit fee", label_sw: "Ada ya permit", amount_kes: fees.permit },
    { code: "PN-02", label_en: "Market levy", label_sw: "Ushuru wa soko", amount_kes: fees.levy },
  ];
  const ruleIds = ["PN-01", "PN-02"];
  const months = startedMonthsSince(p.expires, p.today);
  if (months > 0) {
    lines.push({
      code: "PN-03",
      label_en: `Late penalty, ${months} month${months > 1 ? "s" : ""}`,
      label_sw: `Faini ya kuchelewa, mwezi ${months}`,
      amount_kes: Math.round(fees.permit * 0.1 * months),
    });
    ruleIds.push("PN-03");
  }
  ruleIds.push("PN-05");
  return {
    eligible: true,
    fee_lines: lines,
    total_kes: lines.reduce((s, l) => s + l.amount_kes, 0),
    new_expiry: addMonths(p.expires, 12),
    ruleIds,
  };
}
