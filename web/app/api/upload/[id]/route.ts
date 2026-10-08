import { getServiceSupabase } from "@/lib/supabase-server";
import {
  MAX_UPLOAD_BYTES,
  UUID_RE,
  isExpired,
  simulatedChecks,
  type Upload,
} from "@/lib/upload";

// Mock document upload for any scenario. The file's type and size are checked,
// and its first 12 bytes must be a real JPEG, PNG, WebP, HEIC or PDF; nothing
// else of the file is read, and nothing is stored, logged or echoed. The checks
// stored on the row are simulated from that metadata.

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/upload/[id]">,
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return json({ error: "This link is not valid." }, 404);

  let supabase;
  try {
    supabase = getServiceSupabase();
  } catch {
    return json({ error: "Server is not configured" }, 500);
  }

  const { data: upload, error: loadErr } = await supabase
    .from("uploads")
    .select("*")
    .eq("id", id)
    .maybeSingle<Upload>();
  if (loadErr) return json({ error: "Could not load link" }, 500);
  if (!upload) return json({ error: "This link is not valid." }, 404);

  // Idempotent: an upload that already received a file stays received.
  if (upload.status === "received" || upload.received_at) {
    return json({
      status: "received",
      received_at: upload.received_at,
      checks: upload.checks ?? [],
    });
  }
  if (isExpired(upload)) {
    return json({ status: "expired", error: "This link has expired." }, 410);
  }

  // Refuse oversized bodies before parsing them.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
    return json({ error: "The file is larger than 10 MB." }, 413);
  }

  // Only the metadata of the file part is inspected, then it is dropped.
  let meta = { type: "", size: 0 };
  let realType = "";
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (file && typeof file !== "string") {
      meta = { type: file.type, size: file.size };
      // P14 security: the declared type can be spoofed, so the first 12 bytes must match it.
      realType = sniff(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
    }
  } catch {
    return json({ error: "Expected a multipart form with a file" }, 400);
  }
  if (meta.size <= 0) return json({ error: "Choose a file to upload." }, 400);
  if (!realType) return json({ error: "Please upload a photo or a PDF." }, 415);
  if (meta.size > MAX_UPLOAD_BYTES) {
    return json({ error: "The file is larger than 10 MB." }, 413);
  }

  const checks = simulatedChecks(meta, upload.purpose);
  if (checks.some((c) => c.result === "fail")) {
    return json({ error: "Please upload a photo or a PDF." }, 415);
  }

  const receivedAt = new Date().toISOString();
  const { data: updated, error: updErr } = await supabase
    .from("uploads")
    .update({ status: "received", received_at: receivedAt, checks })
    .eq("id", id)
    .eq("status", "waiting")
    .select("received_at, checks");
  if (updErr) return json({ error: "Could not record the upload" }, 500);

  if (!updated || updated.length === 0) {
    // Another request won the race (or the row changed): report what is stored.
    const { data: current } = await supabase
      .from("uploads")
      .select("status, received_at, checks")
      .eq("id", id)
      .maybeSingle<Pick<Upload, "status" | "received_at" | "checks">>();
    if (current?.status === "received") {
      return json({
        status: "received",
        received_at: current.received_at ?? receivedAt,
        checks: current.checks ?? [],
      });
    }
    return json({ status: "expired", error: "This link has expired." }, 410);
  }

  await supabase.from("audit_log").insert({
    conversation_id: upload.conversation_id,
    authority: upload.authority,
    actor: "Upload",
    // Label only: the subject is a name the caller gave and never goes to the audit log.
    action: `${upload.label} received (demo, file not stored): checks passed`,
    result: "ok",
    rule_ids: [],
    data_used: `Case ${upload.case_ref}`,
  });

  return json({
    status: "received",
    received_at: updated[0].received_at,
    checks: updated[0].checks,
  });
}

/** The file kind from its first bytes (JPEG, PNG, WebP, HEIC, PDF), or "" for anything else. */
function sniff(b: Uint8Array): string {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && /^(heic|heix|mif1|heif)$/.test(ascii(8, 12))) return "image/heic";
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  return "";
}
