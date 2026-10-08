// Finds every agent definition: agents/<country>/<agent>/agent.json (+ prompt.md).

/** Demo code -> agent key. K0: only the Kenya country agent remains. */
export const CODES: Record<string, string> = {
  ke: "KE",
  // K3 (MED-283): SIA, the Konza resident assistant.
  konza: "KONZA",
};

const ROOT = new URL("../", import.meta.url);
const COUNTRIES = ["ke", "konza"];

export type AgentDef = { dir: string; agent: Record<string, any> };

export async function findAgents(): Promise<AgentDef[]> {
  const found: AgentDef[] = [];
  for (const country of COUNTRIES) {
    const base = new URL(`agents/${country}/`, ROOT);
    let entries: Deno.DirEntry[] = [];
    try {
      entries = await Array.fromAsync(Deno.readDir(base));
    } catch {
      continue; // no agents for this country yet
    }
    for (const d of entries.filter((e) => e.isDirectory).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const dir = `agents/${country}/${d.name}`;
      try {
        found.push({
          dir,
          agent: JSON.parse(await Deno.readTextFile(new URL(`${dir}/agent.json`, ROOT))),
        });
      } catch { /* agent not built yet */ }
    }
  }
  return found;
}
