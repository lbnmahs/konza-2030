import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { panelUser } from "@/lib/auth";
import { getServiceSupabase } from "@/lib/supabase-server";
import { formatInZone } from "@/lib/labels";
import styles from "./partner.module.css";

// Mock partner inbox (Wave 3): what a partner organisation received, and nothing more. Values
// were filtered and masked by the backend before they were stored.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Partner inbox",
  robots: { index: false, follow: false },
};

type Referral = {
  ref: string;
  status: "sent" | "scheduled" | "declined";
  fields_sent: Record<string, string>;
  linked_ref: string | null;
  created_at: string;
  sent_at: string | null;
};

type Partner = {
  id: string;
  name: string;
  sector: string;
  country: string;
  offer: string;
  allowed_fields: string[];
};

const TZ: Record<string, string> = { GB: "Europe/London", KE: "Africa/Nairobi", AE: "Asia/Dubai" };
const label = (f: string) => f.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export default async function PartnerInbox(props: PageProps<"/partner/[id]">) {
  if (!(await panelUser())) redirect("/signin");
  const { id } = await props.params;
  let partner: Partner | null = null;
  let rows: Referral[] = [];
  try {
    const db = getServiceSupabase();
    partner = (await db.from("partners").select("id, name, sector, country, offer, allowed_fields")
      .eq("id", id).maybeSingle<Partner>()).data;
    if (partner) {
      rows = ((await db.from("partner_referrals")
        .select("ref, status, fields_sent, linked_ref, created_at, sent_at")
        .eq("partner_id", id).neq("status", "declined").order("created_at", { ascending: false }))
        .data ?? []) as Referral[];
    }
  } catch {
    partner = null;
  }
  const tz = (partner && TZ[partner.country]) ?? "Europe/London";

  return (
    <main className={styles.main}>
      <section className={styles.card}>
        <header className={styles.head}>
          <span className={styles.name}>{partner?.name ?? "Unknown partner"}</span>
          <span className={styles.demo}>DEMO INBOX</span>
        </header>
        {!partner && <p className={styles.muted}>This inbox does not exist.</p>}
        {partner && (
          <>
            <p className={styles.muted}>{partner.offer}</p>
            <p className={styles.small}>
              May receive only: {partner.allowed_fields.map(label).join(", ")}
            </p>
            {rows.length === 0 && <p className={styles.empty}>No referrals yet.</p>}
            <ul className={styles.list}>
              {rows.map((r) => (
                <li key={r.ref} className={styles.item}>
                  <div className={styles.row}>
                    <span className={styles.ref}>{r.ref}</span>
                    <span className={r.status === "sent" ? styles.sent : styles.scheduled}>
                      {r.status === "sent"
                        ? `Received ${formatInZone(r.sent_at ?? r.created_at, tz)}`
                        : `Waiting for approval of ${r.linked_ref}`}
                    </span>
                  </div>
                  {r.status === "sent"
                    ? (
                      <dl className={styles.fields}>
                        {Object.entries(r.fields_sent).map(([k, v]) => (
                          <div key={k} className={styles.field}>
                            <dt>{label(k)}</dt>
                            <dd>{v}</dd>
                          </div>
                        ))}
                      </dl>
                    )
                    : <p className={styles.small}>Details are released only when approved.</p>}
                </li>
              ))}
            </ul>
          </>
        )}
        <footer className={styles.foot}>Simulated partner referral. Independent open-source project.</footer>
      </section>
    </main>
  );
}
