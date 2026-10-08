// Wezesha Njema Council with Kodi Njema Revenue Service: income tax exemption for persons with
// disabilities (N2), modelled on Kenya.
// DS-01 income is exempt up to KES 150,000 a month (KES 1.8 million a year).
// DS-02 the applicant must be registered with the council and have a disability assessment
//       report.
// DS-03 two documents are uploaded for this demo: the assessment report and proof of income.
// DS-04 a joint vetting panel meets the applicant in person, at a step-free venue when needed.
// DS-05 the exemption certificate is valid 5 years, applied by payroll from its start date.

import { addMonths, type ISODate, nextFirstOfMonth } from "../common/dates.ts";

export const DS_MONTHLY_LIMIT_KES = 150_000;
export const DS_DOCUMENTS = ["disability_assessment", "income_proof"] as const;

export function exemptPortion(monthlyIncomeKes: number) {
  return Math.min(Math.max(0, monthlyIncomeKes), DS_MONTHLY_LIMIT_KES);
}

/** On approval: the certificate starts on the 1st of next month and lasts 5 years (DS-05). */
export function certificateDates(approvedOn: ISODate) {
  const start = nextFirstOfMonth(approvedOn);
  return { start_date: start, valid_until: addMonths(start, 60) };
}
