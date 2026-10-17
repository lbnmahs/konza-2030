// K8: every word the resident app shows. English only for now: SIA still speaks
// Swahili when the resident does, and cards show the backend's English text. The reviewed Swahili
// draft is in git (27f3cc9, web/lib/strings/sw.ts) for when the screen gets a second language.

import { INDEPENDENT_TAG } from "../labels";

export const OUTCOME: Record<string, string> = {
  granted: "Approved",
  pending_officer: "With an officer",
  refused: "Refused",
  offered_alternative: "Other offer",
};
const withRef = (ref: string) => (ref ? ` · reference ${ref}` : "");

export const en = {
  label: INDEPENDENT_TAG,
  captions: { label: "Captions", you: "You", agent: "Savannah" },
  state: {
    connecting: "Connecting",
    listening: "Listening",
    speaking: "Speaking",
    working: "Working",
    waiting: "Waiting for you",
    attention: "Needs attention",
    ended: "Ended",
  },
  session: {
    micBlocked: "The microphone is not available, so this conversation is typed.",
    lost: "The connection dropped. Type or tap a mode to start again.",
    limit: "Today's sessions are used up. Please try again tomorrow.",
    noCredits: "Savannah is unavailable until the demo's credits renew. Please try again later.",
    failed: "Savannah could not be reached. Please try again.",
    ended: "Conversation ended. Type or tap a mode to start a new one.",
    text: "Text message",
    toLive: "Start a new conversation in Live mode? This one ends.",
    toLiveYes: "Start Live",
    cancel: "Cancel",
    // K8 S2 (MED-331): a tap the backend did not carry out; nothing is shown as done.
    cardChanged: "That card changed before your tap. Tap Refresh to see it again.",
    notDone: "That could not be done. Nothing has changed.",
    // Sent as the resident's message after a confirm tap, so Savannah answers at once (MED-331).
    confirmedLine: "I confirmed on screen.",
    formLine: "I filled in the form on screen.",
    codeLine: "I entered the code on screen.",
    // MED-333: a child's form that needs the parent's consent first.
    consentLine: "I filled in the form on screen. It needs my consent first.",
    openLine: "I tried to apply on screen, but I already have one in progress.",
    // MED-332: what the resident did on the payment card, never a code or a PIN.
    payCardLine: "I chose to pay by card.",
    payMobileLine: "I chose to pay by mobile money.",
    paidLine: "I approved the payment on screen.",
    slotLine: "I picked a day on screen.",
    payAgainLine: "My payment window closed. Please start the payment again.",
    stepUp: "For your safety, Savannah will send a fresh code first. Then try again.",
    // A form sent before the identity check: say why nothing happened.
    verifyFirst: "Savannah needs to check who you are first. Your answers stay on the form; send it again after.",
    verifyLine: "I filled in the form on screen, but I have not been verified yet.",
    wrongPin: (left: number) => `That PIN is not right. ${left} ${left === 1 ? "try" : "tries"} left.`,
    payDeclined: "The payment was declined. Nothing was taken.",
    applicationOpen: "You already have this application in progress. Ask Savannah where it stands.",
    wrongCode: (left: number) => `That code is not right. ${left} ${left === 1 ? "try" : "tries"} left.`,
  },
  // MED-342: the AI disclosure and the independence label in one line (labelling.md),
  // under the composer in every mode; views without a composer keep the label in the footer.
  disclosure:
    "Savannah is an AI assistant from an independent open-source project, not affiliated with any government body.",
  home: {
    title: "How can I help you today?",
    // The emoji is shown before each suggestion but never sent: a tap sends the text only.
    suggestions: [
      { emoji: "🛂", text: "Renew my passport" },
      { emoji: "🩺", text: "Check my health cover" },
      { emoji: "💼", text: "Register a business" },
      { emoji: "🏫", text: "Find a school place" },
    ],
    label: "Suggestions",
  },
  composer: {
    placeholder: "Ask Savannah",
    listening: "Listening",
    label: "Message to Savannah",
    send: "Send",
    files: "Add files (coming later)",
    dictate: "Speak your message",
    stopDictate: "Stop and review",
    live: "Live conversation",
    mute: "Mute microphone",
    unmute: "Unmute microphone",
    end: "End conversation",
  },
  nav: {
    label: "Main",
    open: "Open menu",
    close: "Close menu",
    collapse: "Collapse sidebar",
    expand: "Expand sidebar",
    fresh: "New conversation",
    servicesHead: "Services",
    explore: "Explore Konza",
    travel: "Travel and Immigration",
    health: "Healthcare",
    business: "Business",
    identity: "Identity",
    city: "City Services",
    applications: "My applications",
    settings: "Settings",
    back: "Back to Savannah",
    skip: "Skip to content",
  },
  applications: {
    title: "My applications",
    empty: "Applications you make with Savannah appear here, with the time and source of each update.",
    verified: "Shown only after you confirm who you are.",
  },
  settings: {
    title: "Settings",
    device: "Settings stay on this device.",
    theme: "Theme",
    themes: { system: "System", light: "Light", dark: "Dark" },
    captions: "Show captions",
    volume: "Savannah's volume",
    motion: "Reduce motion",
    motions: { system: "System", on: "On" },
    privacy: "Privacy and records",
    privacyText:
      "This app keeps no chat history on this device. The voice provider keeps transcripts for 30 days, without audio. Applications, payments and decisions are kept as case records.",
    end: "End session",
  },
  // MED-332: the line a finished card leaves in the conversation when a newer card replaces it.
  log: {
    confirmed: (title: string) => `Done: ${title}`,
    paid: (kes: number, ref: string) => `Paid KES ${kes.toLocaleString("en-GB")}${withRef(ref)}`,
    decision: (outcome: string, ref: string) => `Decision: ${OUTCOME[outcome] ?? outcome}${withRef(ref)}`,
    verified: "Identity checked",
  },
  announce: {
    progress: "Your steps. Details on screen.",
    identity: "Identity check. Details on screen.",
    form: "Your details. Choices on screen.",
    quote: "Fee. Details on screen.",
    confirm: "Confirm. Details on screen.",
    slots: "Choose a day. Details on screen.",
    payment: "Review and pay. Details on screen.",
    "payment.approved": "Payment received. Details on screen.",
    "payment.code": "Enter the payment code. Details on screen.",
    "payment.pin": "Enter your mobile money PIN. Details on screen.",
    "payment.declined": "Payment declined. Details on screen.",
    "payment.expired": "Payment window closed. Details on screen.",
    receipt: "Decision. Details on screen.",
  } as Record<string, string>,
};

export type Strings = typeof en;
