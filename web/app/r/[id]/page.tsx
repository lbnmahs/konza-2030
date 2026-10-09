import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { expired, RECEIPT_DAYS, shownInputs } from "@/lib/receipt";
import { receipt } from "./data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Decision receipt", robots: { index: false } };

const AGENCY: Record<string, string> = {
  sps: "Savanahlands Passport Services",
  siln: "Savanahlands Institute of Learning and Nurturing",
  srr: "Savanahlands Residents Registry",
  sca: "Savanahlands Cover Authority",
  sco: "Savanahlands Company Office",
};

// The explain-why receipt (K3, MED-291): what was decided, who decided, the rules, the reason,
// the inputs used, what happens next and how to ask for review. Linked from the receipt SMS.
export default async function ReceiptPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const r = await receipt(id);
  if (!r) notFound();
  const who = r.decided_by === "rule"
    ? `A published rule (${r.rule_ids.join(", ")})`
    : r.decided_by === "officer"
    ? "An officer"
    : "Waiting for an officer";
  const decided = (r.decided_at ?? r.created_at).slice(0, 10);
  // K6 (MED-311): a link with no sign-in expires, and shows only allowlisted inputs.
  if (expired(r.decided_at ?? r.created_at)) {
    return (
      <main style={{ maxWidth: 520, margin: "6vh auto", padding: 16, lineHeight: 1.5 }}>
        <h1 style={{ fontSize: 20 }}>This receipt link has expired</h1>
        <p>
          Receipt links work for {RECEIPT_DAYS} days after the decision. Ask Savannah to send it
          again, or ask at Lango Square.
        </p>
      </main>
    );
  }
  const inputs = shownInputs(r.application.agency, r.inputs);
  return (
    <main style={{ maxWidth: 520, margin: "6vh auto", padding: 16, lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 20 }}>Decision receipt</h1>
      <p>
        {AGENCY[r.application.agency] ?? r.application.agency}, reference {r.application.ref}
      </p>
      <dl>
        <dt><b>What was decided</b></dt>
        <dd>{r.outcome.replace("_", " ")}</dd>
        <dt><b>Who decided</b></dt>
        <dd>{who}. Never the assistant.</dd>
        <dt><b>Why</b></dt>
        <dd>{r.reason_en}</dd>
        {inputs.length > 0 && (
          <>
            <dt><b>What it was based on</b></dt>
            <dd>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {inputs.map(([k, v]) => <li key={k}>{k}: {v}</li>)}
              </ul>
            </dd>
          </>
        )}
        {r.next_en && (
          <>
            <dt><b>What happens next</b></dt>
            <dd>{r.next_en}</dd>
          </>
        )}
        <dt><b>How to ask for review</b></dt>
        <dd>
          The Aminia Review Panel reviews any decision if you ask within 30 days of {decided}{" "}
          (RV-01). A person who did not make the decision looks at it, free (RV-02), and answers
          within 10 working days with reasons (RV-03). Ask Savannah, or at Lango Square.
        </dd>
      </dl>
    </main>
  );
}
