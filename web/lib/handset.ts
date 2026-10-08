import "server-only";
import { createHash, randomBytes } from "node:crypto";

// Virtual handset (P14 T2): browser calls to a country agent from the signed-in panel.
export const TOKEN_TTL_MS = 3 * 60_000;

export const newToken = () => randomBytes(32).toString("hex");
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
