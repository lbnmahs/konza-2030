// Country agents (hubs): one agent per country, one workflow node per capability. The backend
// and scripts/push-agents.ts both read this file, so a node's tools and the backend gate never
// drift apart. The capability chosen in the call (capability_enter) decides which fictional
// authority handles each tool; a tool outside that capability is refused.

export type Capability = {
  /** The fictional authority that owns this service. */
  authority: string;
  /** Tools only this node may call (on top of SHARED_TOOLS). */
  tools: string[];
};

export type Hub = {
  key: string;
  country: "KE";
  /** K2 Konza: services come from the agency manifest (_shared/konza/manifest.ts) through
   * service_open, not from `capabilities`; the tools are the generic KONZA_TOOLS. */
  generic?: boolean;
  /** The gateway's own authority id (greeting, audit before a capability is chosen). */
  authority: string;
  capabilities: Record<string, Capability>;
};

/** Callable in every node, before a service is chosen (create_case for distress in triage). */
export const PUBLIC_TOOLS = [
  "capability_enter",
  "identity_start_otp",
  "identity_check_otp",
  "record_adjustment",
  "create_case",
];

/** Callable in every capability node (each checks identity itself). */
export const SHARED_TOOLS = [
  "send_message",
  "calendar_email",
  "get_history",
  "refund_request",
  "payment_request",
  "payment_get_status",
  "create_upload_link",
  "get_upload_status",
];

/** K2: the Konza assistant's generic tools. They work on the service service_open chose; the
 * Konza core enforces two-step, consent and the charter itself. */
export const KONZA_TOOLS = [
  "rules_lookup",
  "application_submit",
  "decision_explain",
  "review_request",
  "consent_record",
  "consent_withdraw",
  "address_get",
  "delivery_book",
  // K3 (PY-01): paying with a phone code; PP-03: the biometrics appointment.
  "payment_request",
  "payment_confirm",
  "appointment_book",
];

/** Writes and money: refused once the session is held after an identity concern. */
export const WRITE_TOOLS = [
  "application_submit",
  "review_request",
  "consent_record",
  "delivery_book",
  "appointment_book",
  "calendar_email",
  "payment_request",
  "payment_confirm",
  "refund_request",
  "permit_issue",
  "id_report_loss",
  "id_create_replacement",
  "registry_book_slot",
  "health_record_contribution",
  "health_add_dependant",
  "disability_submit_application",
  "partner_notify",
  "send_message",
  "create_upload_link",
  "passport_apply",
];

/** Need a prepare call and a later commit call with the confirmation id. (permit_issue is not:
 * the backend only issues after an approved payment, which was itself confirmed.) */
export const TWO_STEP_TOOLS = [
  // K2 (MED-269, charter section 7): every asks-first action on the KE agent.
  // (health_record_contribution is not: it only records a payment already confirmed and approved
  // through payment_request, which is two-step and step-up.)
  "registry_book_slot",
  "health_add_dependant",
  "calendar_email",
  "passport_apply",
  "payment_request",
  "refund_request",
  "id_report_loss",
  "disability_submit_application",
];

/** Need identity checked within the last 5 minutes. */
export const STEP_UP_TOOLS = [
  "passport_apply",
  "payment_request",
  "payment_confirm",
  "refund_request",
  "permit_issue",
  "id_report_loss",
  "disability_submit_application",
];

export const HUBS: Record<string, Hub> = {
  KONZA: { key: "KONZA", country: "KE", authority: "sia", generic: true, capabilities: {} },
  KE: {
    key: "KE",
    country: "KE",
    authority: "njia",
    capabilities: {
      permit: {
        authority: "pwani_njema",
        tools: ["permit_lookup", "rules_calculate_renewal", "permit_issue"],
      },
      lost_id: {
        authority: "usajili_njema",
        tools: [
          "id_report_loss",
          "rules_id_replacement",
          "id_create_replacement",
          "registry_list_offices",
          "registry_book_slot",
        ],
      },
      health: {
        authority: "tiba_njema",
        tools: [
          "health_get_member_status",
          "rules_contribution_due",
          "health_record_contribution",
          "health_issue_cover_confirmation",
          "health_add_dependant",
        ],
      },
      passport: {
        authority: "njema_passports",
        tools: [
          "passport_quote",
          "passport_status",
          "passport_apply",
          "registry_list_offices",
          "registry_book_slot",
        ],
      },
      disability: {
        authority: "wezesha_njema",
        tools: [
          "disability_get_status",
          "rules_disability_exemption",
          "disability_submit_application",
          "registry_list_offices",
          "registry_book_slot",
          "partner_list_options",
          "partner_notify",
        ],
      },
    },
  },
};

/** Whether a hub may run this tool in the current capability (null before one is chosen). */
/** Every tool the SIA agent has (K3, MED-283): service_open, the Konza tools, identity, a case,
 * adjustments and the SMS summary. Nothing else is served on the KONZA hub. */
export const KONZA_HUB_TOOLS = [
  "service_open",
  ...KONZA_TOOLS,
  "identity_start_otp",
  "identity_check_otp",
  "create_case",
  "record_adjustment",
  "send_message",
];

export function toolAllowed(hub: Hub, capability: string | null, tool: string): boolean {
  if (hub.generic) {
    if (!KONZA_HUB_TOOLS.includes(tool)) return false;
    if (
      [
        "service_open",
        "identity_start_otp",
        "identity_check_otp",
        "create_case",
        "record_adjustment",
        "consent_withdraw",
        "address_get",
      ].includes(tool)
    ) {
      return true;
    }
    return !!capability;
  }
  if (PUBLIC_TOOLS.includes(tool)) return true;
  if (!capability || !hub.capabilities[capability]) return false;
  return SHARED_TOOLS.includes(tool) || hub.capabilities[capability].tools.includes(tool);
}
