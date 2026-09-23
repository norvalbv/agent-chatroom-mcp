/**
 * Review methods and what they found (paper Results, "How seats check each other"). Tallies the committed
 * LLM-assisted audit of four rooms (bench/results/review-audit/audit-*.json): review acts by method and, per
 * method, how many acts found a defect. The counts are the first auditor's; the second auditor's corrections are
 * carried as text in the same file and are quoted, not tallied.
 *
 * Usage: node --import tsx scripts/paper-review-audit.ts AUDIT_JSON --out PREFIX --tex FILE
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const METHODS = ["reran_author_command", "read_diff_only", "own_independent_test", "exercised_real_behaviour", "provenance_check", "asserted_without_evidence"] as const;
export type Method = (typeof METHODS)[number];
export const METHOD_LABEL: Record<Method, string> = {
  reran_author_command: "Re-ran the author's test, suite or build",
  read_diff_only: "Read the diff or code, ran nothing",
  own_independent_test: "Ran a check the author had not supplied",
  exercised_real_behaviour: "Used the system as its users would",
  provenance_check: "Checked what a commit or merge contains",
  asserted_without_evidence: "Approved with no stated check",
};
/** Short labels for the paper table, matching the figure's. */
export const METHOD_SHORT: Record<Method, string> = {
  reran_author_command: "Re-ran author's test/build",
  read_diff_only: "Read the diff only",
  own_independent_test: "Own check",
  exercised_real_behaviour: "Used it as users would",
  provenance_check: "Checked commit contents",
  asserted_without_evidence: "No stated check",
};
const ROOM_SHORT: Record<string, string> = { "Hub room A": "Hub A", "Hub room B": "Hub B", "Game room 1": "Game 1", "Game room 2": "Game 2" };
export const ROOM_LABEL: Record<string, string> = {
  "swarm-083203-kooz": "Hub room A",
  "swarm-092653-202z": "Hub room B",
  "swarm-193626-mwbk": "Game room 1",
  "swarm-221023-k6l4": "Game room 2",
};
interface Act { method: Method; found_defect: boolean }
interface AuditRoom { room: string; review_acts: Act[] }

export function tally(rooms: AuditRoom[]) {
  const per = rooms.map((r) => {
    const acts = Object.fromEntries(METHODS.map((m) => [m, 0])) as Record<Method, number>;
    const defects = Object.fromEntries(METHODS.map((m) => [m, 0])) as Record<Method, number>;
    for (const a of r.review_acts) {
      if (!(a.method in acts)) throw Error(`unknown method ${a.method} in ${r.room}`);
      acts[a.method]++;
      if (a.found_defect) defects[a.method]++;
    }
    return { room: r.room, label: ROOM_LABEL[r.room] ?? r.room, n: r.review_acts.length, acts, defects };
  });
  const total = { acts: {} as Record<Method, number>, defects: {} as Record<Method, number>, n: 0, found: 0 };
  for (const m of METHODS) {
    total.acts[m] = per.reduce((s, r) => s + r.acts[m], 0);
    total.defects[m] = per.reduce((s, r) => s + r.defects[m], 0);
  }
  total.n = per.reduce((s, r) => s + r.n, 0);
  total.found = METHODS.reduce((s, m) => s + total.defects[m], 0);
  const yieldOf = Object.fromEntries(METHODS.map((m) => [m, total.acts[m] ? Number((total.defects[m] / total.acts[m]).toFixed(2)) : null]));
  return { rooms: per, total, yield: yieldOf };
}

export function renderMarkdown(t: ReturnType<typeof tally>): string {
  return [
    "# Review methods and what they found", "",
    `${t.total.n} review acts in ${t.rooms.length} rooms; ${t.total.found} of them found a defect.`, "",
    "| Method | " + t.rooms.map((r) => r.label).join(" | ") + " | All | Of all acts | Found a defect | Share |",
    "|---|" + t.rooms.map(() => "---|").join("") + "---|---|---|---|",
    ...METHODS.map((m) => `| ${METHOD_LABEL[m]} | ${t.rooms.map((r) => r.acts[m]).join(" | ")} | ${t.total.acts[m]} | ${t.total.acts[m]}/${t.total.n} | ${t.total.defects[m]}/${t.total.acts[m]} | ${t.yield[m] ?? "n/a"} |`),
    "",
  ].join("\n");
}

export function renderTex(t: ReturnType<typeof tally>): string {
  return [
    `\\begin{tabular}{l${"r".repeat(t.rooms.length)}rr}`, "\\toprule",
    `Review method & ${t.rooms.map((r) => ROOM_SHORT[r.label] ?? r.label).join(" & ")} & All & Found a defect \\\\`, "\\midrule",
    ...METHODS.map((m) => `${METHOD_SHORT[m]} & ${t.rooms.map((r) => r.acts[m]).join(" & ")} & ${t.total.acts[m]} & ${t.total.defects[m]} \\\\`),
    "\\midrule",
    `All review acts & ${t.rooms.map((r) => r.n).join(" & ")} & ${t.total.n} & ${t.total.found} \\\\`,
    "\\bottomrule", "\\end{tabular}", "",
    `\\emph{Review acts (one seat checking another's work) in two rooms that changed this system and two that built a browser game, classified by an AI auditor from the room logs and the seats' own transcripts. A second auditor re-counted each room; it moved individual acts between methods but confirmed the main pattern (Section~\\ref{sec:results-review}).}`, "",
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const [file] = args;
  if (!file || !args.includes("--out") || !args.includes("--tex")) throw Error("Usage: AUDIT_JSON --out PREFIX --tex FILE");
  const out = args[args.indexOf("--out") + 1];
  const tex = args[args.indexOf("--tex") + 1];
  const t = tally(JSON.parse(readFileSync(file, "utf8")).rooms);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(`${out}.json`, JSON.stringify(t, null, 2) + "\n");
  writeFileSync(`${out}.md`, renderMarkdown(t));
  writeFileSync(tex, renderTex(t));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
