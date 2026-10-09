// deno task release <out dir> --version vX.Y.Z [--notes <file>] [--repo <git url>]
// K7 (MED-319): builds the public release from the committed tree (git archive HEAD, so untracked
// local files such as .env never enter it), removes what stays private and checks it. Since
// v0.1.3 (Mahs, 9 Oct) a release is a normal commit and tag on top of the release repository's
// history, never a force-pushed orphan: <out dir> is a fresh clone of the release repository
// with its tree replaced by the export, committed and tagged. Refuses on any failed check, an
// existing tag or an unchanged tree. Pushing (without --force) is a separate, approved step.

const [out, ...rest] = Deno.args;
const flag = (name: string) => {
  const i = rest.indexOf(name);
  return i === -1 ? undefined : rest[i + 1];
};
const version = flag("--version");
const notesFile = flag("--notes");
const repo = flag("--repo") ?? "https://github.com/lbnmahs/konza-2030.git";
if (!out || !version || !/^v\d+\.\d+\.\d+$/.test(version)) {
  console.error(
    "usage: deno task release <out dir> --version vX.Y.Z [--notes <file>] [--repo <git url>]",
  );
  Deno.exit(2);
}

/** Paths that stay private (plan-k7 MED-319, Mahs 8 Oct): internal plans, prompts, history,
 * the release working files, and the notes for the coding assistant. */
export const PRIVATE = [
  "CLAUDE.md",
  ".claude/",
  "docs/konza-inventory.md",
  "docs/plan-konza.md",
  "docs/konza/release/",
  /^docs\/konza\/plan-k\d+\.md$/,
];

const isPrivate = (p: string) =>
  PRIVATE.some((x) => typeof x === "string" ? p === x || p.startsWith(x) : x.test(p));

async function run(cmd: string, args: string[], cwd?: string) {
  const o = await new Deno.Command(cmd, { args, cwd, stdout: "piped", stderr: "piped" }).output();
  const text = new TextDecoder().decode(o.stdout) + new TextDecoder().decode(o.stderr);
  if (!o.success) throw new Error(`${cmd} ${args.join(" ")}: ${text.slice(0, 500)}`);
  return text;
}

if ((await run("git", ["status", "--porcelain", "--untracked-files=no"])).trim()) {
  throw new Error("commit or stash changes first: the release is built from HEAD");
}
try {
  if ([...Deno.readDirSync(out)].length) throw new Error(`${out} is not empty`);
} catch (e) {
  if (!(e instanceof Deno.errors.NotFound)) throw e;
}
const notes = notesFile ? (await Deno.readTextFile(notesFile)).trim() : "";

// 0. The release repository's history, its tree emptied (.git stays) for the new export.
await run("git", ["clone", "-q", repo, out]);
if ((await run("git", ["tag", "-l", version], out)).trim()) {
  throw new Error(`${version} already exists in ${repo}`);
}
await run("git", ["rm", "-rq", "--ignore-unmatch", "."], out);

// 1. The committed tree, minus the private paths.
const files = (await run("git", ["ls-files"])).split("\n").filter(Boolean);
const shipped = files.filter((f) => !isPrivate(f));
const tar = await new Deno.Command("git", {
  args: ["archive", "HEAD", ...shipped],
  stdout: "piped",
})
  .output();
const tmp = await Deno.makeTempFile({ suffix: ".tar" });
await Deno.writeFile(tmp, tar.stdout);
await run("tar", ["-x", "-C", out, "-f", tmp]);
await Deno.remove(tmp);

// 2. References to private notes become plain words; ids leave the published counts.
const SELF = "scripts/release.ts";
const REWRITE: [RegExp, string][] = [
  [/`?docs\/konza\/plan-k(\d+)\.md`?/g, "the K$1 design notes (kept private)"],
  [/`?docs\/konza-inventory\.md`?/g, "the K0 inventory (kept private)"],
  [/`?docs\/plan-konza\.md`?/g, "the project plan (kept private)"],
  [/`?docs\/konza\/release\/scan\.md`?/g, "the release scan (kept private)"],
];
const textFile = (f: string) =>
  !/\.(png|jpg|jpeg|gif|ico|woff2?|ttf|pdf|lock)$/.test(f) && !f.endsWith("package-lock.json") &&
  !f.endsWith("tsconfig.tsbuildinfo");
for (const f of shipped.filter((f) => textFile(f) && f !== SELF)) {
  const path = `${out}/${f}`;
  let text = await Deno.readTextFile(path).catch(() => null);
  if (text === null) continue;
  const before = text;
  for (const [re, to] of REWRITE) text = text.replace(re, to);
  if (f.startsWith("docs/konza/audit/") && f.endsWith(".json")) {
    const j = JSON.parse(text);
    delete j.batch;
    text = JSON.stringify(j, null, 2) + "\n";
  }
  if (text !== before) await Deno.writeTextFile(path, text);
}

// 3. Checks over every shipped text file.
const DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const REAL_UK = /\+44\s?7(?!700\s?900)\d{3}\s?\d{6}/;
const KENYAN = /\+2547\d{8}/;
const IDS = /\b(conv|trun|suite)_[0-9a-z]{20,}\b|\bmsgbatch_[0-9A-Za-z]{10,}\b/;
const LINK_PRIVATE =
  /(docs\/history\/|docs\/prompts\/|docs\/konza\/release\/|docs\/konza\/plan-k\d+\.md|konza-inventory\.md)/;
const problems: string[] = [];
for (const f of shipped) {
  if (!textFile(f)) continue;
  const text = await Deno.readTextFile(`${out}/${f}`).catch(() => "");
  if (DASH.test(text)) problems.push(`${f}: en or em dash`);
  if (REAL_UK.test(text) || KENYAN.test(text)) {
    problems.push(`${f}: a phone number outside the drama range`);
  }
  if (IDS.test(text)) problems.push(`${f}: a conversation, test run or batch id`);
  if (f !== SELF && LINK_PRIVATE.test(text)) problems.push(`${f}: refers to a private path`);
}
if (DASH.test(notes)) problems.push(`${notesFile}: en or em dash`);
if (IDS.test(notes)) problems.push(`${notesFile}: a conversation, test run or batch id`);
for (const f of shipped) {
  if (/(^|\/)\.env(\.|$)/.test(f) && !/\.env\.example$/.test(f)) problems.push(`${f}: env file`);
}
const readme = await Deno.readTextFile(`${out}/README.md`);
const label = /not affiliated with (the [\w ]+ or )?any government body/i;
if (!label.test(readme)) problems.push("README.md: no independence line");
if (!label.test(await Deno.readTextFile(`${out}/web/lib/labels.ts`))) {
  problems.push("web/lib/labels.ts: no label");
}
for (const f of ["LICENSE", "NOTICE", "SECURITY.md", "THREAT_MODEL.md", "ACCEPTABLE_USE.md"]) {
  try {
    await Deno.stat(`${out}/${f}`);
  } catch {
    problems.push(`${f}: missing`);
  }
}
const leaks = await new Deno.Command("gitleaks", {
  args: ["dir", out, "--redact", "--no-banner", "--log-level", "error"],
  stdout: "piped",
  stderr: "piped",
}).output().catch(() => null);
if (!leaks) problems.push("gitleaks: not installed");
else if (!leaks.success) {
  problems.push("gitleaks: findings (run it on the export to see them, redacted)");
}

if (problems.length) {
  console.error(`release refused, ${problems.length} problems:\n${problems.join("\n")}`);
  Deno.exit(1);
}

// 4. One commit on top of the release history, tagged.
const author = (await run("git", ["config", "user.name"])).trim();
const email = (await run("git", ["config", "user.email"])).trim();
const as = ["-c", `user.name=${author}`, "-c", `user.email=${email}`];
await run("git", ["add", "-A"], out);
const stat = (await run("git", ["diff", "--cached", "--stat"], out)).trim();
if (!stat) {
  console.error(`release refused: nothing changed since the last release in ${repo}`);
  Deno.exit(1);
}
await run("git", [
  ...as,
  "commit",
  "-q",
  "-m",
  `konza-2030 ${version}${notes ? `\n\n${notes}` : ""}

Independent open-source project. Not affiliated with the Konza Technopolis Development Authority or any government body.`,
], out);
await run("git", [...as, "tag", "-a", version, "-m", `konza-2030 ${version}`], out);
console.log(`${stat}\n`);
console.log(
  `${shipped.length} files, ${
    files.length - shipped.length
  } kept private; checks passed; committed and tagged ${version} on top of ${repo} in ${out}.
Review: git -C ${out} show --stat HEAD
Push (after approval, never --force): git -C ${out} push origin main ${version}`,
);
