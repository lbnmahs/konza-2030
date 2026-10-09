"use client";

import { useState, type FormEvent } from "react";
import { formatInZone } from "@/lib/labels";
import {
  MAX_UPLOAD_BYTES,
  formatSize,
  isAcceptedType,
  type UploadCheck,
} from "@/lib/upload";
import styles from "./upload.module.css";

type Props = {
  id: string;
  caseRef: string;
  requested: string;
  authorityName: string;
  timezone: string;
  photo: boolean;
  expiresAtText: string;
  initialReceived: boolean;
  initialReceivedAt: string | null;
  initialChecks: UploadCheck[];
};

// The chosen file goes straight into the request body. Nothing here reads
// its contents; only the name, type and size are used.
export default function UploadForm({
  id,
  caseRef,
  requested,
  authorityName,
  timezone,
  photo,
  expiresAtText,
  initialReceived,
  initialReceivedAt,
  initialChecks,
}: Props) {
  const [received, setReceived] = useState(initialReceived);
  const [receivedAt, setReceivedAt] = useState<string | null>(
    initialReceivedAt,
  );
  const [checks, setChecks] = useState<UploadCheck[]>(initialChecks);
  const [expired, setExpired] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    if (!file || file.size === 0) {
      setError(photo ? "Take or choose a photo first." : "Choose a file to upload.");
      return;
    }
    if (!isAcceptedType(file.type)) {
      setError("Please upload a photo or a PDF.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("The file is larger than 10 MB.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`/api/upload/${id}`, { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        received_at?: string | null;
        checks?: UploadCheck[];
        error?: string;
      };
      if (data.status === "received") {
        setFile(null);
        setReceivedAt(data.received_at ?? null);
        setChecks(Array.isArray(data.checks) ? data.checks : []);
        setReceived(true);
      } else if (res.status === 410) {
        setExpired(true);
      } else {
        setError(data.error ?? "Something went wrong. Try again.");
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (expired) {
    return (
      <div className={styles.center} aria-live="polite">
        <span className={styles.iconWarn} aria-hidden="true">
          !
        </span>
        <h1 className={styles.title}>This link has expired.</h1>
        <p className={styles.muted}>
          Please call {authorityName} for a new one.
        </p>
      </div>
    );
  }

  if (received) {
    return (
      <div className={styles.center} aria-live="polite">
        <span className={styles.iconOk} aria-hidden="true">
          &#10003;
        </span>
        <h1 className={styles.title}>Received (demo, file not stored)</h1>
        <p className={styles.muted}>{requested}</p>
        <p className={styles.small}>Reference {caseRef}</p>
        {checks.length > 0 && (
          <ul className={styles.checks} aria-label="Checks">
            {checks.map((c) => (
              <li key={c.check} className={styles.check}>
                <span
                  className={c.result === "pass" ? styles.checkPass : styles.checkFail}
                  aria-hidden="true"
                >
                  {c.result === "pass" ? "✓" : "✕"}
                </span>
                <span className={styles.checkName}>{c.check}</span>
                <span className={styles.checkDetail}>{c.detail}</span>
              </li>
            ))}
          </ul>
        )}
        {receivedAt && (
          <p className={styles.small}>
            Received {formatInZone(receivedAt, timezone)}
          </p>
        )}
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} aria-live="polite">
      <div>
        <p className={styles.label}>Document upload</p>
        <h1 className={styles.ref}>{requested}</h1>
      </div>

      <dl className={styles.facts}>
        <div>
          <dt>Reference</dt>
          <dd>{caseRef}</dd>
        </div>
        <div>
          <dt>Link expires</dt>
          <dd>{expiresAtText}</dd>
        </div>
      </dl>

      <label className={styles.picker}>
        <input
          type="file"
          name="file"
          accept="image/*,application/pdf"
          capture={photo ? "user" : undefined}
          className={styles.fileInput}
          disabled={busy}
          onChange={(e) => {
            setError(null);
            setFile(e.target.files?.[0] ?? null);
          }}
        />
        <span className={styles.pickerTitle}>
          {file ? file.name : photo ? "Take a photo" : "Take a photo or choose a file"}
        </span>
        <span className={styles.pickerHint}>
          {file
            ? formatSize(file.size)
            : photo
              ? "Opens the front camera. Photo, up to 10 MB"
              : "Camera, photo or PDF, up to 10 MB"}
        </span>
      </label>

      {error && <p className={styles.errorText}>{error}</p>}

      <button type="submit" className={styles.button} disabled={busy || !file}>
        {busy ? "Uploading" : "Upload"}
      </button>

      <p className={styles.note}>
        This is a demo. The file is not stored or read.
      </p>
    </form>
  );
}
