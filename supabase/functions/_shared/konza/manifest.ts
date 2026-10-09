// Konza agencies (K2). An agency joins by one entry here; the profile's paths, the core and the
// assistant's tools are generic and never change for it.

import { sca } from "./agencies/sca.ts";
import { sco } from "./agencies/sco.ts";
import { siln } from "./agencies/siln.ts";
import { sps } from "./agencies/sps.ts";
import { srr } from "./agencies/srr.ts";
import type { Agency } from "./types.ts";

export const AGENCIES: Record<string, Agency> = Object.fromEntries(
  [sps, siln, srr, sca, sco].map((a) => [a.id, a]),
);
