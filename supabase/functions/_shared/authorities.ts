// Every fictional authority: country, languages, currency, time zone and payment skin.
// The backend reads this module directly; scripts/demo.ts copies it into the `authorities`
// table so the panel, /pesa and /upload can show the same facts.

export type Country = "KE";

export type Authority = {
  id: string;
  country: Country;
  name: string;
  default_language: string;
  languages: string[];
  currency: "KES";
  timezone: string;
  payment_skin: "mobile_money" | "card";
};

const KE = {
  country: "KE",
  currency: "KES",
  timezone: "Africa/Nairobi",
  payment_skin: "mobile_money",
};

export const AUTHORITIES: Record<string, Authority> = Object.fromEntries(
  ([
    // NJIA: the Kenya country agent's gateway (P13). Services stay with their own authorities.
    { ...KE, id: "njia", name: "NJIA", default_language: "sw", languages: ["sw", "en"] },
    // P15: passports on NJIA (fictional).
    {
      ...KE,
      id: "njema_passports",
      name: "Njema Passport Service",
      default_language: "sw",
      languages: ["sw", "en"],
    },
    {
      ...KE,
      id: "pwani_njema",
      name: "Pwani Njema County Government",
      default_language: "sw",
      languages: ["sw", "en"],
    },
    {
      ...KE,
      id: "usajili_njema",
      name: "Usajili Njema",
      default_language: "sw",
      languages: ["sw", "en"],
    },
    {
      ...KE,
      id: "tiba_njema",
      name: "Tiba Njema Cover Authority",
      default_language: "sw",
      languages: ["sw", "en"],
    },
    // K2 Konza (docs/konza/world.md): the assistant and the agencies behind the API profile.
    {
      ...KE,
      id: "sia",
      name: "Savanah Information and Access (SIA)",
      // K3: calls greet in English (the passport scene); Swahili stays the agent's main language.
      default_language: "en",
      languages: ["sw", "en"],
    },
    {
      ...KE,
      id: "srr",
      name: "Savanahlands Residents Registry",
      default_language: "sw",
      languages: ["sw", "en"],
    },
    {
      ...KE,
      id: "sps",
      name: "Savanahlands Passport Services",
      default_language: "sw",
      languages: ["sw", "en"],
    },
    {
      ...KE,
      id: "siln",
      name: "Savanahlands Institute of Learning and Nurturing",
      default_language: "sw",
      languages: ["sw", "en"],
    },
    // K3 scenes (world.md section 2, names checked 5 Oct).
    {
      ...KE,
      id: "sca",
      name: "Savanahlands Cover Authority",
      default_language: "sw",
      languages: ["sw", "en"],
    },
    {
      ...KE,
      id: "sco",
      name: "Savanahlands Company Office",
      default_language: "sw",
      languages: ["sw", "en"],
    },
    {
      ...KE,
      id: "aminia",
      name: "Aminia Review Panel",
      default_language: "sw",
      languages: ["sw", "en"],
    },
    {
      ...KE,
      id: "wezesha_njema",
      name: "Wezesha Njema Council",
      default_language: "sw",
      languages: ["sw", "en"],
    },
  ] as Authority[]).map((a) => [a.id, a]),
);

export function authority(id: string): Authority {
  const a = AUTHORITIES[id];
  if (!a) throw new Error(`Unknown authority ${id}`);
  return a;
}
