// K8: the words only the cards use, apart from en.ts so they load with the cards (Board.tsx, on
// demand) and not with /sia's first paint (the 150 KB budget). Board merges them into
// the strings it passes down; the Strings type covers both.

import { OUTCOME } from "./en";

export const enCards = {
  steps: {
    identity: "Identity",
    consent: "Consent",
    details: "Details",
    confirm: "Confirm",
    pay: "Pay",
    book: "Book",
    deliver: "Delivery",
    decision: "Decision",
  } as Record<string, string>,
  // current is a step the core recorded as waiting (a decision with an officer; MED-331).
  stepState: { todo: "to do", current: "waiting", done: "done" } as Record<string, string>,
  card: {
    rule: "Rule",
    confirm: "Yes, confirm",
    notNow: "Not now",
    back: "Back",
    next: "Continue",
    refresh: "Refresh",
    notDone: "Not done",
    expired: "Expired",
    done: "Done",
    left: (m: number, s: number) => `${m}:${String(s).padStart(2, "0")} left`,
    // WCAG 2.2.1 (MED-332): what a screen reader hears as a timed card runs out.
    oneMinute: "One minute left.",
    timeUp: "Time is up. Nothing was done.",
    day: "Choose a day",
    time: "Choose a time",
    book: "Book this time",
    decision: "Decision",
    decidedBy: "Decided by",
    rulePublished: "A published rule",
    officer: "An officer",
    pending: "Waiting for an officer",
    why: "Why",
    nextStep: "Next",
    review: "Review",
    reviewLine: (date: string) => `Aminia Review Panel · free · ask by ${date}`,
    open: "Open receipt",
    newTab: "(opens in a new tab)",
    yes: "Yes",
    optional: "Optional",
    // MED-333: the consent variant of the confirm card (a parent acting for a child).
    consentNote: "You give this consent as the child's parent or guardian. You can withdraw it at any time.",
    updated: (time: string, source: string) => `Updated ${time} · ${source}`,
  },
  identity: {
    title: "Confirm it's you",
    sent: (channel: string) => (channel === "voice" ? "We are calling you with a code" : "We just sent you a text"),
    sendAgain: "Send again",
    noCode: "Didn't get the code?",
    verifiedText: "Your identity is confirmed for this conversation.",
    continue: "Continue",
    details: "Savannah will ask for your resident number and date of birth.",
    code: (channel: string) =>
      channel === "voice" ? "Enter the code from the call we just made." : "Enter the code we just texted you.",
    field: "6-digit code",
    check: "Check code",
    attempts: (n: number) => `${n} ${n === 1 ? "try" : "tries"} left`,
    verified: "Identity confirmed",
  },
  pay: {
    title: "Review and pay",
    method: "Pay with",
    change: "Change",
    card: "Debit or credit card",
    mobile: "Mobile money",
    affirm: "I confirm the details in this application are true.",
    pay: (amount: string) => `Pay ${amount}`,
    processing: "Processing",
    paid: "Paid",
    received: "Payment received",
    reference: "Reference",
    declined: "Not paid",
    expired: "Payment window closed",
    again: "Start again",
    simulated: "Simulated payment. No real money moves.",
    desk: "Or pay at a desk",
    // MED-332: a fictional payment is still authorised.
    codeTitle: "Approve with the code",
    codeSub: "We texted a 6-digit code to your phone. Type it here, or read it to Savannah.",
    codeField: "Card payment code",
    pinTitle: "Approve with your PIN",
    pinSub: "Type your mobile money PIN. Savannah never asks for it out loud.",
    pinField: "Mobile money PIN",
    approve: "Approve payment",
    attempts: (n: number) => `${n} ${n === 1 ? "try" : "tries"} left`,
  },
  outcome: OUTCOME,
};

/** What the cards read: the general words and their own. */
export type CardStrings = import("./en").Strings & typeof enCards;
