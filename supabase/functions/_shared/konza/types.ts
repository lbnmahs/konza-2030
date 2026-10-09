// Konza API profile (K2): shared types. Spec: spec/konza-2030-api/openapi.yaml.

import type { Citizen } from "../session.ts";
import type { ReadBack } from "../readback.ts";

export type CharterLevel = "acts_alone" | "asks_first" | "never_acts";

/** Generic operations and their charter levels (the spec's x-konza-charter). */
export const OPERATIONS: Record<string, CharterLevel> = {
  listAgencies: "acts_alone",
  getService: "acts_alone",
  askRules: "acts_alone",
  submitApplication: "asks_first",
  getApplication: "acts_alone",
  getDecision: "acts_alone",
  decideAsOfficer: "never_acts",
  appealDecision: "asks_first",
  recordConsent: "asks_first",
  withdrawConsent: "acts_alone",
  getAddress: "acts_alone",
  bookDelivery: "asks_first",
  bookAppointment: "asks_first",
  // K3 (PY-02, DK-01): desk work, officer credential only.
  recordDeskPayment: "never_acts",
  recordDeskDocument: "never_acts",
};

export type Resident = Citizen & { resident_number: string };

/** Who is calling. The assistant (client "sia") gets the resident from the verified conversation;
 * other member systems assert it (demo only; the target is OIDC). */
export type Caller = {
  client: string;
  requestId: string;
  session: string | null;
  resident: Resident | null;
  /** Set only by the officer credential. */
  officer?: string;
};

export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  pattern?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  description?: string;
  $ref?: string;
  default?: unknown;
  examples?: unknown[];
};

export type RuleAnswer = {
  topic: string;
  values: Record<string, unknown>;
  rule_ids: string[];
  reason_en: string;
  reason_sw?: string;
  /** How the assistant must say it (MED-299). */
  say?: string;
};

/** What a service's rules decide about an application. A rule may only grant; anything else is
 * pending an officer (charter 2.2). */
export type DecisionDraft = {
  outcome: "granted" | "pending_officer";
  rule_ids: string[];
  reason_en: string;
  reason_sw?: string;
  inputs: Record<string, unknown>;
  next_en?: string;
};

export type DecideCtx = {
  applicant: Resident;
  subject: Resident;
  fields: Record<string, unknown>;
  today: string;
};

export type ServiceDef = {
  title: string;
  /** Steps for the assistant, in plain words; returned by service_open. */
  card: string;
  topics: Record<
    string,
    {
      needsResident: boolean;
      answer: (
        resident: Resident | null,
        inputs: Record<string, unknown>,
        today: string,
      ) => Promise<RuleAnswer>;
    }
  >;
  applicationSchema: JsonSchema;
  /** Scope a delegate needs to apply for someone else; null means only for oneself. */
  consentScope: string | null;
  /** Read-back of what the application will do. */
  /** The asks-first read-back in English and Swahili, from rule outputs (K5, MED-301). */
  summarize: (fields: Record<string, unknown>, subject: Resident) => ReadBack;
  decide: (ctx: DecideCtx) => Promise<DecisionDraft>;
  /** Runs once when an officer or a rule grants (e.g. take a school place), before the decision
   * is stored. Returns false when it could not take effect; the grant then waits for an officer. */
  onGranted?: (
    fields: Record<string, unknown>,
    inputs: Record<string, unknown>,
    outcome: "granted" | "offered_alternative",
  ) => Promise<boolean>;
  /** Undoes what onGranted took, when the decision could not be stored (K4, MED-280). */
  onUndo?: (
    fields: Record<string, unknown>,
    inputs: Record<string, unknown>,
    outcome: "granted" | "offered_alternative",
  ) => Promise<void>;
  /** An in-person step after the grant (PP-03 biometrics), booked by the holder. */
  appointment?: {
    kind: "biometrics";
    desk: "lango_square" | "konza_passport_desk";
    title: string;
    title_sw: string;
    afterPayment: boolean;
    rule_ids: string[];
    bring: string;
    bring_sw: string;
    /** When the result is due after the appointment, from the rules (PP-04). */
    readyBy?: (onDate: string) => string;
  };
  /** What a granted application costs (PY-01, PY-02), from its recorded inputs; null if free. */
  charge?: (
    fields: Record<string, unknown>,
    inputs: Record<string, unknown>,
  ) => { amount_kes: number; rule_ids: string[]; description: string } | null;
  /** The document a granted application produces, if it can be delivered (AD-02 to AD-06). */
  deliverable?: { kind: "passport" | "resident_card" | "certificate"; holderOnly: boolean };
};

export type Agency = {
  id: string;
  name: string;
  /** Authority id in _shared/authorities.ts (time zone, language, audit). */
  authority: string;
  /** Where a resident can go in person when the agency's systems are down. */
  desk?: string;
  services: Record<string, ServiceDef>;
};

export class KonzaError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    /** What the assistant should say or do, when different from the message. */
    public say?: string,
  ) {
    super(message);
  }
}
