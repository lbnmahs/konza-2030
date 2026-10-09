import type { Metadata } from "next";
import { getServiceSupabase } from "@/lib/supabase-server";
import { authorityName, formatInZone } from "@/lib/labels";
import type { Authority } from "@/lib/types";
import {
  UUID_RE,
  authorityMark,
  isExpired,
  isPhotoPurpose,
  requestedText,
  type Upload,
  type UploadCheck,
} from "@/lib/upload";
import UploadForm from "./UploadForm";
import styles from "./upload.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Document upload",
  description: "Mock document upload page for the demo (files are not stored)",
  robots: { index: false, follow: false },
};

// Used when the link is invalid or the authority row is missing.
const DEFAULT_TZ = "Europe/London";

type Header = { name: string; timezone: string };

type Loaded =
  | { state: "invalid" }
  | { state: "error" }
  | { state: "expired"; ref: string }
  | {
      state: "received" | "ready";
      id: string;
      ref: string;
      requested: string;
      photo: boolean;
      expiresAt: string;
      receivedAt: string | null;
      checks: UploadCheck[];
    };

async function load(id: string): Promise<{ data: Loaded; header: Header | null }> {
  if (!UUID_RE.test(id)) return { data: { state: "invalid" }, header: null };
  let supabase;
  try {
    supabase = getServiceSupabase();
  } catch {
    return { data: { state: "error" }, header: null };
  }

  const { data: upload, error } = await supabase
    .from("uploads")
    .select("*")
    .eq("id", id)
    .maybeSingle<Upload>();
  if (error) return { data: { state: "error" }, header: null };
  if (!upload) return { data: { state: "invalid" }, header: null };

  const { data: auth } = await supabase
    .from("authorities")
    .select("name, timezone")
    .eq("id", upload.authority)
    .maybeSingle<Pick<Authority, "name" | "timezone">>();
  const header: Header = {
    name: auth?.name ?? authorityName(upload.authority),
    timezone: auth?.timezone ?? DEFAULT_TZ,
  };

  const received = upload.status === "received" || !!upload.received_at;
  if (!received && isExpired(upload)) {
    return { data: { state: "expired", ref: upload.case_ref }, header };
  }
  return {
    data: {
      state: received ? "received" : "ready",
      id: upload.id,
      ref: upload.case_ref,
      requested: requestedText(upload),
      photo: isPhotoPurpose(upload.purpose),
      expiresAt: upload.expires_at,
      receivedAt: upload.received_at,
      checks: Array.isArray(upload.checks) ? upload.checks : [],
    },
    header,
  };
}

export default async function UploadPage(props: PageProps<"/upload/[id]">) {
  const { id } = await props.params;
  const { data, header } = await load(id);
  const name = header?.name ?? "Document upload";

  return (
    <main className={styles.main}>
      <section className={styles.card} aria-label="Document upload">
        <header className={styles.head}>
          <span className={styles.mark} aria-hidden="true">
            {header ? authorityMark(header.name) : "?"}
          </span>
          <span className={styles.authority}>{name}</span>
          <span className={styles.demo}>DEMO</span>
        </header>

        <div className={styles.body}>
          {data.state === "invalid" && (
            <div className={styles.center}>
              <span className={styles.iconMuted} aria-hidden="true">
                ?
              </span>
              <h1 className={styles.title}>This link is not valid.</h1>
              <p className={styles.muted}>
                Check the link in your text message.
              </p>
            </div>
          )}

          {data.state === "error" && (
            <div className={styles.center}>
              <span className={styles.iconMuted} aria-hidden="true">
                !
              </span>
              <h1 className={styles.title}>Something went wrong.</h1>
              <p className={styles.muted}>Please try again in a moment.</p>
            </div>
          )}

          {data.state === "expired" && (
            <div className={styles.center}>
              <span className={styles.iconWarn} aria-hidden="true">
                !
              </span>
              <h1 className={styles.title}>This link has expired.</h1>
              <p className={styles.muted}>Please call {name} for a new one.</p>
              <p className={styles.small}>Reference {data.ref}</p>
            </div>
          )}

          {(data.state === "received" || data.state === "ready") && header && (
            <UploadForm
              id={data.id}
              caseRef={data.ref}
              requested={data.requested}
              authorityName={header.name}
              timezone={header.timezone}
              photo={data.photo}
              expiresAtText={formatInZone(data.expiresAt, header.timezone)}
              initialReceived={data.state === "received"}
              initialReceivedAt={data.receivedAt}
              initialChecks={data.checks}
            />
          )}
        </div>

        <footer className={styles.foot}>
          Files are not stored or read.
        </footer>
      </section>
    </main>
  );
}
