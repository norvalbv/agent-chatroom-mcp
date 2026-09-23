/**
 * What peer verification exercised (paper Results, "How seats check each other"). Every verify/* board write
 * whose first line is a JSON verify head, from every recorded room, classified by what its command ran.
 *
 * Usage:
 *   node --import tsx scripts/paper-verify-practice.ts --extract DATA_DIR > bench/results/verify-practice/heads.jsonl
 *   node --import tsx scripts/paper-verify-practice.ts HEADS_JSONL ROOMS_JSON LABELS_JSON --out PREFIX --tex FILE
 *
 * --extract reads the hub's room logs (DATA_DIR/swarm-*-room.jsonl, not committed) and prints one row per verify
 * head, with the maintainer's home directory shortened. It is run by the maintainer; the committed JSONL is the
 * source. Commands that look like a browser run, a reviewer-written probe or a live agent run are candidates and
 * must carry a hand label in LABELS_JSON (the pattern only finds them; a label decides), so new data cannot slip
 * into a class unread.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Kind = "hub" | "web" | "other";
export type Klass = "existing_tests" | "scripted_smoke" | "browser" | "own_probe" | "real_agents";
export const CLASSES: Klass[] = ["existing_tests", "scripted_smoke", "own_probe", "browser", "real_agents"];
export const CLASS_LABEL: Record<Klass, string> = {
  existing_tests: "Build, type-check or the project's existing tests",
  scripted_smoke: "Scripted smoke client against a built hub (no model seats)",
  own_probe: "A check the verifying seat wrote itself",
  browser: "The built application driven in a real browser",
  real_agents: "Model-driven agents run on the changed build",
};
export interface HeadRow { id: string; room: string; key: string; by: string | null; proposal: string | null; proposer: string | null; exit_code: number | null; commit_named: boolean; command: string }
export interface Label { class: Klass; note: string }

const CANDIDATE: [Klass, RegExp][] = [
  ["real_agents", /swarm\.js|dist\/index\.js.*claude|bench-rq1\.ts\S* .*(--seats|--model)|\bclaude -p\b|revive\.js/],
  ["browser", /playwright|puppeteer|screenshot|chromium|headless|webkit|\bvite\b/i],
  ["own_probe", /<<|python3 -|node -e|node --eval|\/tmp\/[\w./-]+\.(?:ts|js|py|mjs|sh)|\bcurl\b|git show [^ ]+:/],
];

/** The class a command gets before any hand label: a candidate pattern, the smoke script, or existing tests. */
export function candidateOf(command: string): Klass | null {
  for (const [k, re] of CANDIDATE) if (re.test(command)) return k;
  return null;
}

export function classify(row: HeadRow, labels: Record<string, Label>): Klass {
  const label = labels[row.id];
  if (label) return label.class;
  if (candidateOf(row.command)) throw Error(`unlabelled candidate ${row.id}: ${row.command.slice(0, 120)}`);
  return /smoke\.ts/.test(row.command) ? "scripted_smoke" : "existing_tests";
}

export function extractHeads(roomLog: string, room: string, home = process.env.HOME ?? ""): HeadRow[] {
  const proposer = new Map<string, string>();
  const rows: HeadRow[] = [];
  let ordinal = 0;
  const shorten = (s: string) => (home ? s.split(home).join("~") : s);
  for (const line of roomLog.split("\n")) {
    if (!line.trim()) continue;
    let e: any;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === "proposal" && e.proposal?.id) proposer.set(e.proposal.id, e.proposal.by?.name ?? null);
    if (e.type !== "board" || !String(e.key ?? "").startsWith("verify/") || !e.entry) continue;
    const id = `${room}#${ordinal++}`;
    const first = String(e.entry.text ?? "").split("\n", 1)[0].trim();
    if (!first.startsWith("{")) continue;
    let h: any;
    try { h = JSON.parse(first); } catch { continue; }
    if (!h || typeof h !== "object") continue;
    const proposal = typeof h.proposal === "string" ? h.proposal : null;
    rows.push({
      id, room, key: e.key, by: e.entry.by ?? null, proposal, proposer: proposal ? proposer.get(proposal) ?? null : null,
      exit_code: typeof h.exit_code === "number" ? h.exit_code : null, commit_named: Boolean(h.commit),
      command: shorten(String(h.command ?? "")),
    });
  }
  return rows;
}

type Counts = Record<Klass, number>;
const zero = (): Counts => Object.fromEntries(CLASSES.map((k) => [k, 0])) as Counts;

export function buildReport(rows: HeadRow[], rooms: Record<string, Kind>, labels: Record<string, Label>) {
  const byKind: Record<Kind, Counts> = { hub: zero(), web: zero(), other: zero() };
  const all = zero();
  const nonAuthor = zero();
  const roomsByKind: Record<Kind, Set<string>> = { hub: new Set(), web: new Set(), other: new Set() };
  let zeroExit = 0, nonzeroExit = 0, missingExit = 0, commitNamed = 0, nonAuthorN = 0;
  for (const r of rows) {
    const kind = rooms[r.room];
    if (!kind) throw Error(`room ${r.room} has no kind in the rooms file`);
    const k = classify(r, labels);
    all[k]++; byKind[kind][k]++; roomsByKind[kind].add(r.room);
    if (r.exit_code === 0) zeroExit++; else if (r.exit_code === null) missingExit++; else nonzeroExit++;
    if (r.commit_named) commitNamed++;
    if (r.proposer && r.by && r.by !== r.proposer) { nonAuthorN++; nonAuthor[k]++; }
  }
  return {
    heads: rows.length, rooms: new Set(rows.map((r) => r.room)).size,
    rooms_by_kind: { hub: roomsByKind.hub.size, web: roomsByKind.web.size, other: roomsByKind.other.size },
    exit_code: { zero: zeroExit, nonzero: nonzeroExit, missing: missingExit },
    commit_named: commitNamed, classes: all, by_kind: byKind,
    non_author: { heads: nonAuthorN, classes: nonAuthor },
    labelled: Object.keys(labels).length,
  };
}

export function renderMarkdown(t: ReturnType<typeof buildReport>): string {
  const L = [
    "# What peer verification exercised", "",
    `${t.heads} verify heads in ${t.rooms} rooms (${t.rooms_by_kind.hub} hub, ${t.rooms_by_kind.web} web application, ${t.rooms_by_kind.other} other).`,
    `Exit code 0: ${t.heads === 0 ? 0 : t.exit_code.zero}/${t.heads}; nonzero: ${t.exit_code.nonzero}/${t.heads}; missing: ${t.exit_code.missing}/${t.heads}. Commit named: ${t.commit_named}/${t.heads}.`,
    `Heads by a seat other than the proposal's author, where the author is known: ${t.non_author.heads}.`, "",
    "| What the command ran | Hub rooms | Web rooms | Other | All | Not by the author |", "|---|---|---|---|---|---|",
    ...CLASSES.map((k) => `| ${CLASS_LABEL[k]} | ${t.by_kind.hub[k]} | ${t.by_kind.web[k]} | ${t.by_kind.other[k]} | ${t.classes[k]}/${t.heads} | ${t.non_author.classes[k]}/${t.non_author.heads} |`),
    "", `Hand-labelled candidates: ${t.labelled}.`, "",
  ];
  return L.join("\n");
}

export function renderTex(t: ReturnType<typeof buildReport>): string {
  const L = [
    "\\begin{tabular}{lrrrr}", "\\toprule",
    "What the verifying command ran & Hub & Web app & Other & All \\\\", "\\midrule",
    ...CLASSES.map((k) => `${CLASS_LABEL[k]} & ${t.by_kind.hub[k]} & ${t.by_kind.web[k]} & ${t.by_kind.other[k]} & ${t.classes[k]} \\\\`),
    "\\midrule",
    `Rooms & ${t.rooms_by_kind.hub} & ${t.rooms_by_kind.web} & ${t.rooms_by_kind.other} & ${t.rooms} \\\\`,
    "\\bottomrule", "\\end{tabular}", "",
    `\\emph{Every structured verify entry recorded by the hub (${t.heads} entries), classified by what its command ran. Hub rooms changed this system; web-app rooms built a browser game. Commands matching a browser, probe or agent pattern (${t.labelled}) were classified by hand; the rest by whether they ran the smoke script. ${t.exit_code.zero} of ${t.heads} entries report exit code 0 and ${t.commit_named} of ${t.heads} name the commit they checked.}`, "",
  ];
  return L.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--extract") {
    const dir = args[1];
    if (!dir) throw Error("Usage: --extract DATA_DIR");
    for (const f of readdirSync(dir).filter((f) => /^swarm-.*-room\.jsonl$/.test(f)).sort()) {
      for (const row of extractHeads(readFileSync(join(dir, f), "utf8"), f.replace(/-room\.jsonl$/, ""))) console.log(JSON.stringify(row));
    }
    return;
  }
  const [headsFile, roomsFile, labelsFile] = args;
  const out = args[args.indexOf("--out") + 1];
  const tex = args[args.indexOf("--tex") + 1];
  if (!headsFile || !roomsFile || !labelsFile || !args.includes("--out") || !args.includes("--tex")) throw Error("Usage: HEADS_JSONL ROOMS_JSON LABELS_JSON --out PREFIX --tex FILE");
  const rows: HeadRow[] = readFileSync(headsFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const rooms = JSON.parse(readFileSync(roomsFile, "utf8")).rooms as Record<string, Kind>;
  const labels = JSON.parse(readFileSync(labelsFile, "utf8")).labels as Record<string, Label>;
  const t = buildReport(rows, rooms, labels);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(`${out}.json`, JSON.stringify(t, null, 2) + "\n");
  writeFileSync(`${out}.md`, renderMarkdown(t));
  writeFileSync(tex, renderTex(t));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
