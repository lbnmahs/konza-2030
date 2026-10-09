// Shared helpers for the mock document upload page (any scenario).
// Pure functions only: safe to import from server and client code.

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Upper bound for the demo upload. The file is only checked, never stored.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type UploadCheck = {
  check: string;
  result: "pass" | "fail";
  detail: string;
};

export type Upload = {
  id: string;
  conversation_id: string;
  authority: string;
  case_ref: string;
  purpose: string;
  label: string;
  subject: string;
  status: "waiting" | "received" | "expired";
  checks: UploadCheck[];
  expires_at: string;
  received_at: string | null;
  created_at: string;
};

// Purposes that ask for a face photo: the picker opens the front camera.
const PHOTO_PURPOSES = new Set(["passport_photo", "photo"]);

export function isPhotoPurpose(purpose: string): boolean {
  return PHOTO_PURPOSES.has(purpose);
}

// "Student certificate for Amina", or just the label.
export function requestedText(u: Pick<Upload, "label" | "subject">): string {
  return u.subject ? `${u.label} for ${u.subject}` : u.label;
}

// "Qamar Bay Residency Authority" -> "QB". One word -> its first two letters.
export function authorityMark(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isAcceptedType(type: string): boolean {
  return type.startsWith("image/") || type === "application/pdf";
}

// Simulated checks from file metadata only (type and size). The bytes are
// never read, so "Face detected" is a hard-coded demo pass.
export function simulatedChecks(
  file: { type: string; size: number },
  purpose: string,
): UploadCheck[] {
  const checks: UploadCheck[] = [
    {
      check: "File type",
      result: isAcceptedType(file.type) ? "pass" : "fail",
      detail: file.type || "unknown",
    },
    {
      check: "Size",
      result: file.size > 0 && file.size <= MAX_UPLOAD_BYTES ? "pass" : "fail",
      detail: formatSize(file.size),
    },
  ];
  if (isPhotoPurpose(purpose)) {
    checks.push({ check: "Face detected", result: "pass", detail: "simulated" });
  }
  return checks;
}

export function isExpired(
  u: Pick<Upload, "expires_at" | "status">,
  now = Date.now(),
) {
  return u.status === "expired" || Date.parse(u.expires_at) < now;
}
