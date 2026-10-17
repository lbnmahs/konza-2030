import type { Metadata } from "next";
import changelog from "@/lib/spec/changelog.json";
import {
  CATALOG_VERSION,
  CHARTER,
  cardKinds,
  markdownBlocks,
  operations,
  SUMMARY,
  TITLE,
  VERSION,
} from "@/lib/developers";
import s from "./developers.module.css";

export const metadata: Metadata = {
  title: "Konza API profile",
  description: "The konza-2030-api profile of Kenya's GIF v3.0: operations, charter levels and the screen cards",
};

// K8 S5 (MED-335, plan-k8 2.8): the API page, public, rendered once at build from the checked copies
// of the spec (web/lib/spec, web/lib/ui). Server only: no client component and no script of its own.
export const dynamic = "force-static";

const LEVEL: Record<string, string> = {
  acts_alone: "Acts alone",
  asks_first: "Asks first",
  never_acts: "Officer only",
};

export default function Developers() {
  const groups = operations();
  const blocks = markdownBlocks(changelog.markdown);
  return (
    <main className={s.page}>
      <header>
        <h1>Konza API profile</h1>
        <p className={s.lead}>{SUMMARY}</p>
        <p className={s.meta}>
          {TITLE} · version {VERSION} · OpenAPI 3.1 · Apache-2.0 · screen cards {CATALOG_VERSION}
        </p>
      </header>

      <nav aria-label="On this page" className={s.toc}>
        <ul>
          <li><a href="#charter">Charter levels</a></li>
          <li><a href="#confirm">Confirm, then commit</a></li>
          <li><a href="#operations">Operations</a></li>
          <li><a href="#join">How an agency joins</a></li>
          <li><a href="#cards">Screen cards</a></li>
          <li><a href="#changes">Changes</a></li>
        </ul>
      </nav>

      <section id="charter" aria-labelledby="charter-h">
        <h2 id="charter-h">Charter levels</h2>
        <p>Every operation says what an assistant acting for a resident may do with it.</p>
        <dl className={s.levels}>
          {CHARTER.map((c) => (
            <div key={c.level}>
              <dt>{LEVEL[c.level]} <code>{c.level}</code></dt>
              <dd>{c.words}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="confirm" aria-labelledby="confirm-h">
        <h2 id="confirm-h">Confirm, then commit</h2>
        <ol>
          <li>The assistant calls an asks-first operation. Nothing happens yet: the answer is 202 with a <code>confirmation_id</code> and a read-back in English and Swahili.</li>
          <li>It reads the read-back to the resident, or shows it on a card, and waits for a clear yes.</li>
          <li>It repeats the same request with the <code>confirmation_id</code>, at least 4 seconds and at most 3 minutes later. Now it happens.</li>
          <li>A second commit of the same confirmation returns the stored result; nothing happens twice. A card tap commits exactly what the card showed.</li>
        </ol>
        <p>Decisions are made by published rules or by an officer, never by an assistant. A rule may only grant; anything adverse waits for an officer, and every decision names its rules, its reason and the review route.</p>
      </section>

      <section id="operations" aria-labelledby="operations-h">
        <h2 id="operations-h">Operations</h2>
        <p>
          Every request carries <code>X-Konza-Request-Id</code> and is logged as an audit event. Agencies are data: a new
          agency appears under the same generic paths.
        </p>
        {groups.map((g) => (
          <div key={g.tag} className={s.scroll} tabIndex={0} role="region" aria-label={`${g.tag} operations`}>
            <table className={s.ops}>
              <caption>{g.tag}</caption>
              <thead>
                <tr>
                  <th scope="col">Request</th>
                  <th scope="col">What it does</th>
                  <th scope="col">Charter</th>
                  <th scope="col">Statuses</th>
                </tr>
              </thead>
              <tbody>
                {g.ops.map((o) => (
                  <tr key={o.id}>
                    <th scope="row">
                      <code>{o.method} {o.path}</code>
                      <span className={s.opId}>{o.id}</span>
                    </th>
                    <td>{o.summary}</td>
                    <td>{LEVEL[o.charter]}</td>
                    <td>{o.statuses.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      <section id="join" aria-labelledby="join-h">
        <h2 id="join-h">How an agency joins</h2>
        <ol>
          <li>Write one file in <code>supabase/functions/_shared/konza/agencies/</code>: its services, the rules each decision cites, an application schema with a label for every field, and any fee.</li>
          <li>Add one entry to the manifest (<code>supabase/functions/_shared/konza/manifest.ts</code>). No new paths: the agency appears under <code>/agencies</code>.</li>
          <li>Run the checks on the local stack: <code>deno task test</code> and <code>deno task contract</code>, which validates the spec, calls every documented path and status, and checks each response against its schema.</li>
        </ol>
      </section>

      <section id="cards" aria-labelledby="cards-h">
        <h2 id="cards-h">Screen cards ({CATALOG_VERSION})</h2>
        <p>The backend shows a resident only these cards, after a tool result; the model never draws the screen. Clients ignore kinds they do not know.</p>
        <dl className={s.levels}>
          {cardKinds().map((k) => (
            <div key={k.kind}>
              <dt><code>{k.kind}</code></dt>
              <dd>{k.words}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="changes" aria-labelledby="changes-h">
        <h2 id="changes-h">Changes</h2>
        {blocks.map((b, i) =>
          b.kind === "h2"
            ? <h3 key={i}>{b.text}</h3>
            : b.kind === "h3"
            ? <h4 key={i}>{b.text}</h4>
            : b.kind === "li"
            ? <p key={i} className={s.item}>{b.text}</p>
            : <p key={i}>{b.text}</p>
        )}
      </section>
    </main>
  );
}
