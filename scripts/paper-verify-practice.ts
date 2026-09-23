/**
 * What peer verification exercised (paper Results, "How seats check each other"). Every verify/* board write
 * whose first line is a JSON verify head, from every recorded room, classified by what its command ran.
 *
 * Usage:
 *   node --import tsx scripts/paper-verify-practice.ts --extract DATA_DIR > bench/results/verify-practice/heads.jsonl
 *   node --import tsx scripts/paper-verify-practice.ts HEADS_JSONL ROOMS_JSON CODES_JSON --out PREFIX --tex FILE
 *
 * --extract reads every hub room log created before CENSUS_CUTOFF (DATA_DIR/swarm-*.jsonl, sub-rooms included; not
 * committed) and prints one row per verify/* write whose first line is a JSON object, with the entry's full text and
 * the maintainer's home directory shortened. It is run by the maintainer; the committed JSONL is the source.
 * Classes come from CODES_JSON: two independent coders read each entry's full text, and an adjudicator settled
 * every disagreement. A row without a final code fails the report, so new data cannot slip into a class unread.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseVerifyHead } from "../src/hub.ts";

/** Rooms created from this instant on are the 2026-09-23 experiments, not part of the census. */
export const CENSUS_CUTOFF = "2026-09-23T10:00:00Z";

export type Kind = "hub" | "web" | "other";
export type Klass = "agents_on_changed_build" | "app_in_browser" | "own_check" | "scripted_smoke" | "existing_tests" | "inspection_only" | "unclear";
export const CLASSES: Klass[] = ["existing_tests", "scripted_smoke", "inspection_only", "own_check", "app_in_browser", "agents_on_changed_build", "unclear"];
export const CLASS_LABEL: Record<Klass, string> = {
  existing_tests: "Build, type-check or existing tests only",
  scripted_smoke: "Scripted smoke client, model spawning off",
  inspection_only: "Read code, docs or history; ran nothing",
  own_check: "A check the verifying seat wrote itself",
  app_in_browser: "The built application in a real browser",
  agents_on_changed_build: "Model-driven agents on the changed build",
  unclear: "Not enough detail to tell",
};
export interface HeadRow { id: string; room: string; key: string; by: string | null; proposal: string | null; proposer: string | null; exit_code: number | null; commit_named: boolean; schema_valid: boolean; command: string; text: string; room_created?: string }
export interface Code { class: Klass; reason: string }
export interface Codes { coder_a: Record<string, Code>; coder_b: Record<string, Code>; final: Record<string, Code & { basis: "agreed" | "adjudicated" }> }

export function classify(row: HeadRow, codes: Codes): Klass {
  const c = codes.final[row.id];
  if (!c) throw Error(`no final code for ${row.id}`);
  if (!CLASSES.includes(c.class)) throw Error(`unknown class ${c.class} for ${row.id}`);
  return c.class;
}

/** Raw agreement and Cohen's kappa between the two coders over the rows both coded. */
export function agreement(rows: HeadRow[], codes: Codes) {
  const both = rows.filter((r) => codes.coder_a[r.id] && codes.coder_b[r.id]);
  const n = both.length;
  const agree = both.filter((r) => codes.coder_a[r.id].class === codes.coder_b[r.id].class).length;
  let pe = 0;
  for (const k of CLASSES) {
    const pa = both.filter((r) => codes.coder_a[r.id].class === k).length / (n || 1);
    const pb = both.filter((r) => codes.coder_b[r.id].class === k).length / (n || 1);
    pe += pa * pb;
  }
  const po = n ? agree / n : 0;
  return { coded_by_both: n, agreed: agree, kappa: pe < 1 ? Number(((po - pe) / (1 - pe)).toFixed(2)) : 1 };
}

export function extractHeads(roomLog: string, room: string, home = process.env.HOME ?? ""): HeadRow[] {
  const proposer = new Map<string, string>();
  const rows: HeadRow[] = [];
  let ordinal = 0;
  let created: string | undefined;
  const shorten = (s: string) => (home ? s.split(home).join("~") : s);
  for (const line of roomLog.split("\n")) {
    if (!line.trim()) continue;
    let e: any;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === "room" && typeof e.createdAt === "string") created = e.createdAt.slice(0, 10);
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
      schema_valid: parseVerifyHead(String(e.entry.text ?? "")) !== undefined,
      command: shorten(typeof h.command === "string" ? h.command : Array.isArray(h.commands) ? h.commands.join(" && ") : ""),
      text: shorten(String(e.entry.text ?? "")).slice(0, 4000),
      room_created: created,
    });
  }
  return rows;
}

type Counts = Record<Klass, number>;
const zero = (): Counts => Object.fromEntries(CLASSES.map((k) => [k, 0])) as Counts;

export function buildReport(rows: HeadRow[], rooms: Record<string, Kind>, codes: Codes) {
  const byKind: Record<Kind, Counts> = { hub: zero(), web: zero(), other: zero() };
  const all = zero();
  const nonAuthor = zero();
  const roomsByKind: Record<Kind, Set<string>> = { hub: new Set(), web: new Set(), other: new Set() };
  let zeroExit = 0, nonzeroExit = 0, missingExit = 0, commitNamed = 0, nonAuthorN = 0, schemaValid = 0;
  for (const r of rows) {
    const kind = rooms[r.room];
    if (!kind) throw Error(`room ${r.room} has no kind in the rooms file`);
    const k = classify(r, codes);
    all[k]++; byKind[kind][k]++; roomsByKind[kind].add(r.room);
    if (r.exit_code === 0) zeroExit++; else if (r.exit_code === null) missingExit++; else nonzeroExit++;
    if (r.commit_named) commitNamed++;
    if (r.schema_valid) schemaValid++;
    if (r.proposer && r.by && r.by !== r.proposer) { nonAuthorN++; nonAuthor[k]++; }
  }
  return {
    heads: rows.length, rooms: new Set(rows.map((r) => r.room)).size,
    created_from: rows.map((r) => r.room_created ?? "").filter(Boolean).sort()[0] ?? null,
    created_to: rows.map((r) => r.room_created ?? "").filter(Boolean).sort().at(-1) ?? null,
    rooms_by_kind: { hub: roomsByKind.hub.size, web: roomsByKind.web.size, other: roomsByKind.other.size },
    exit_code: { zero: zeroExit, nonzero: nonzeroExit, missing: missingExit },
    commit_named: commitNamed, schema_valid: schemaValid, classes: all, by_kind: byKind,
    non_author: { heads: nonAuthorN, classes: nonAuthor },
    coding: { ...agreement(rows, codes), adjudicated: rows.filter((r) => codes.final[r.id]?.basis === "adjudicated").length },
  };
}

export function renderMarkdown(t: ReturnType<typeof buildReport>): string {
  const L = [
    "# What peer verification did", "",
    `${t.heads} verify/* writes whose first line is a JSON object, in ${t.rooms} rooms and sub-rooms (${t.rooms_by_kind.hub} hub project, ${t.rooms_by_kind.web} browser game, ${t.rooms_by_kind.other} other), created ${t.created_from} to ${t.created_to}, before ${CENSUS_CUTOFF}.`,
    `Valid under the hub's own head parser: ${t.schema_valid}/${t.heads}. Reported exit code 0: ${t.exit_code.zero}/${t.heads}; nonzero: ${t.exit_code.nonzero}/${t.heads}; missing: ${t.exit_code.missing}/${t.heads}. Commit named: ${t.commit_named}/${t.heads}.`,
    `Coding: two independent coders agreed on ${t.coding.agreed}/${t.coding.coded_by_both} entries (Cohen's kappa ${t.coding.kappa}); ${t.coding.adjudicated} were settled by an adjudicator.`,
    `Entries by a seat other than the proposal's author, where the author is known: ${t.non_author.heads}.`, "",
    "| Strongest check the entry reports | Hub | Game | Other | All | Not by the author |", "|---|---|---|---|---|---|",
    ...CLASSES.map((k) => `| ${CLASS_LABEL[k]} | ${t.by_kind.hub[k]} | ${t.by_kind.web[k]} | ${t.by_kind.other[k]} | ${t.classes[k]}/${t.heads} | ${t.non_author.classes[k]}/${t.non_author.heads} |`),
    "",
  ];
  return L.join("\n");
}

export function renderTex(t: ReturnType<typeof buildReport>): string {
  const L = [
    "\\begin{tabular}{lrrrr}", "\\toprule",
    "Strongest check the entry reports & Hub & Game & Other & All \\\\", "\\midrule",
    ...CLASSES.map((k) => `${CLASS_LABEL[k]} & ${t.by_kind.hub[k]} & ${t.by_kind.web[k]} & ${t.by_kind.other[k]} & ${t.classes[k]} \\\\`),
    "\\midrule",
    `Rooms and sub-rooms & ${t.rooms_by_kind.hub} & ${t.rooms_by_kind.web} & ${t.rooms_by_kind.other} & ${t.rooms} \\\\`,
    "\\bottomrule", "\\end{tabular}", "",
    `\\emph{All ${t.heads} verification entries with a structured head, classified by the strongest check the entry's text reports. Two AI coders classified every entry independently from its full text (agreement ${t.coding.agreed}/${t.coding.coded_by_both}, Cohen's \\(\\kappa\\)=${t.coding.kappa}); an adjudicator settled the ${t.coding.adjudicated} disagreements. Classes describe what the entry says was run, not verified execution. Hub: rooms on this system's code, research or documentation; Game: rooms building a browser game.}`, "",
  ];
  return L.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--extract") {
    const dir = args[1];
    if (!dir) throw Error("Usage: --extract DATA_DIR");
    for (const f of readdirSync(dir).filter((f) => /^swarm-.*\.jsonl$/.test(f)).sort()) {
      const log = readFileSync(join(dir, f), "utf8");
      let created: string | undefined;
      try { created = JSON.parse(log.slice(0, log.indexOf("\n") >>> 0)).createdAt; } catch { created = undefined; }
      if (!created || created >= CENSUS_CUTOFF) continue;
      for (const row of extractHeads(log, f.replace(/(-room)?\.jsonl$/, ""))) console.log(JSON.stringify(row));
    }
    return;
  }
  const [headsFile, roomsFile, codesFile] = args;
  const out = args[args.indexOf("--out") + 1];
  const tex = args[args.indexOf("--tex") + 1];
  if (!headsFile || !roomsFile || !codesFile || !args.includes("--out") || !args.includes("--tex")) throw Error("Usage: HEADS_JSONL ROOMS_JSON CODES_JSON --out PREFIX --tex FILE");
  const rows: HeadRow[] = readFileSync(headsFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const rooms = JSON.parse(readFileSync(roomsFile, "utf8")).rooms as Record<string, Kind>;
  const codes = JSON.parse(readFileSync(codesFile, "utf8")) as Codes;
  const t = buildReport(rows, rooms, codes);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(`${out}.json`, JSON.stringify(t, null, 2) + "\n");
  writeFileSync(`${out}.md`, renderMarkdown(t));
  writeFileSync(tex, renderTex(t));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
