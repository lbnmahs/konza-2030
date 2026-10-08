// Konza API profile, REST surface (K2): /tools/konza/v1/... as in spec/konza-2030-api/openapi.yaml.
// Member systems authenticate with the demo client secret and assert the resident
// (X-Konza-Resident); officers use their own credential, which the client secret never replaces.

import * as core from "../../_shared/konza/core.ts";
import { type Caller, KonzaError } from "../../_shared/konza/types.ts";
import { sameSecret } from "../../_shared/secret.ts";
import { isUuid, str } from "../../_shared/util.ts";

const problem = (status: number, code: string, detail: string) =>
  new Response(
    JSON.stringify({
      type: `https://api.konza.example/problems/${code}`,
      title: code,
      status,
      code,
      detail,
    }),
    { status, headers: { "content-type": "application/problem+json" } },
  );

const ok = (body: any, created = false) =>
  Response.json(body, { status: body?.needs_confirmation ? 202 : created ? 201 : 200 });

export async function konzaApi(req: Request, path: string): Promise<Response> {
  // Officer routes: deciding, and desk work (PY-02, DK-01).
  const officerRoute = /^\/decisions\/[^/]+\/officer-decision$/.test(path) ||
    /^\/desk\/(payments|documents)$/.test(path);
  const officerOk = sameSecret(
    req.headers.get("x-officer-secret"),
    Deno.env.get("KONZA_OFFICER_SECRET"),
  );
  // Member systems use their own secret, never the assistant's TOOL_SECRET.
  const clientOk = sameSecret(
    req.headers.get("x-tool-secret"),
    Deno.env.get("KONZA_CLIENT_SECRET"),
  );
  if (officerRoute ? !officerOk : !clientOk) {
    return problem(401, "unauthorised", "Missing or wrong credential.");
  }
  const requestId = str(req.headers.get("x-konza-request-id"));
  if (!isUuid(requestId)) {
    return problem(400, "request_id_required", "X-Konza-Request-Id must be a UUID.");
  }

  try {
    const residentNo = str(req.headers.get("x-konza-resident"));
    const resident = residentNo ? await core.residentByNumber(residentNo) : null;
    if (residentNo && !resident) {
      return problem(403, "unknown_resident", "No resident with that number.");
    }
    const client = str(req.headers.get("x-konza-client")).toLowerCase();
    const body = req.method === "GET" || req.method === "DELETE"
      ? {}
      : await req.json().catch(() => null);
    if (body === null) return problem(400, "bad_json", "The body must be JSON.");
    // "sia" is the in-process assistant only; a member system cannot claim it, use consents
    // granted to it, or reach a call's session (REST sessions live in their own namespace).
    const clientId = /^[a-z0-9_-]{1,32}$/.test(client) ? client : "member";
    if (clientId === "sia") {
      return problem(400, "reserved_client", "The client id sia is reserved.");
    }
    const session = str(req.headers.get("x-konza-session")).slice(0, 128);
    const caller: Caller = {
      client: clientId,
      requestId,
      session: session ? `rest:${clientId}:${session}` : null,
      resident,
    };
    const m = req.method;
    let p: string[];

    if (m === "GET" && path === "/agencies") return ok(await core.listAgencies(caller));
    if (
      (p = match(
        path,
        /^\/agencies\/([a-z0-9_]+)\/services\/([a-z0-9_]+)(\/rules|\/applications)?$/,
      ))
    ) {
      const [agency, service, tail] = p;
      if (m === "GET" && !tail) return ok(await core.getService(caller, agency, service));
      if (m === "POST" && tail === "/rules") {
        return ok(await core.askRules(caller, agency, service, str(body.topic), body.inputs ?? {}));
      }
      if (m === "POST" && tail === "/applications") {
        return ok(
          await core.submitApplication(
            caller,
            agency,
            service,
            body.fields ?? {},
            str(req.headers.get("x-konza-on-behalf-of")) || null,
            str(body.confirmation_id) || null,
          ),
          true,
        );
      }
    }
    if ((p = match(path, /^\/applications\/([^/]+)\/appointments$/)) && m === "POST") {
      return isUuid(p[0])
        ? ok(
          await core.bookAppointment(
            caller,
            {
              application_id: p[0],
              window: str(body.window),
              on_date: str(body.on_date) || undefined,
            },
            str(body.confirmation_id) || null,
          ),
          true,
        )
        : notFound();
    }
    if ((p = match(path, /^\/applications\/([^/]+)$/)) && m === "GET") {
      return isUuid(p[0]) ? ok(await core.getApplication(caller, p[0])) : notFound();
    }
    if ((p = match(path, /^\/decisions\/([^/]+)(\/officer-decision|\/appeals)?$/))) {
      const [id, tail] = p;
      if (!isUuid(id)) return notFound();
      if (m === "GET" && !tail) return ok(await core.getDecision(caller, id));
      if (m === "POST" && tail === "/officer-decision") {
        return ok(
          await core.decideAsOfficer(
            { ...caller, officer: str(body.officer) || "officer" },
            id,
            body,
          ),
        );
      }
      if (m === "POST" && tail === "/appeals") {
        return ok(
          await core.appealDecision(
            caller,
            id,
            str(body.grounds),
            str(body.confirmation_id) || null,
          ),
          true,
        );
      }
    }
    if (m === "POST" && path === "/desk/payments") {
      return ok(
        await core.recordDeskPayment({ ...caller, officer: str(body.officer) || "officer" }, body),
        true,
      );
    }
    if (m === "POST" && path === "/desk/documents") {
      return ok(
        await core.recordDeskDocument({ ...caller, officer: str(body.officer) || "officer" }, body),
        true,
      );
    }
    if (m === "POST" && path === "/consents") {
      return ok(await core.recordConsent(caller, body, str(body.confirmation_id) || null), true);
    }
    if ((p = match(path, /^\/consents\/([^/]+)$/)) && m === "DELETE") {
      return isUuid(p[0]) ? ok(await core.withdrawConsent(caller, p[0])) : notFound();
    }
    if (m === "GET" && path === "/residents/me/address") return ok(await core.getAddress(caller));
    if (m === "POST" && path === "/deliveries") {
      return ok(await core.bookDelivery(caller, body, str(body.confirmation_id) || null), true);
    }
    return notFound();
  } catch (e) {
    if (e instanceof KonzaError) return problem(e.status, e.code, e.message);
    console.error(JSON.stringify({ konza_api: String(e) }));
    return problem(500, "server_error", "The system could not complete this.");
  }
}

const notFound = () => problem(404, "not_found", "No such resource.");

function match(path: string, re: RegExp): string[] {
  const m = path.match(re);
  return m ? m.slice(1).map((x) => x ?? "") : (null as unknown as string[]);
}
