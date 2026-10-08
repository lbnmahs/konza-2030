// Minimal ElevenLabs Agents REST client shared by the scripts.

const BASE = "https://api.elevenlabs.io/v1/convai";
const ROOT = "https://api.elevenlabs.io";

export function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing ${name} in .env`);
  return v;
}

export async function eleven<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  // Paths starting with /v1/ are absolute (e.g. /v1/workspace/webhooks); others are under convai.
  const res = await fetch(path.startsWith("/v1/") ? `${ROOT}${path}` : `${BASE}${path}`, {
    method,
    headers: { "xi-api-key": env("ELEVENLABS_API_KEY"), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}
