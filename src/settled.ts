/**
 * Settled axes: if the target project keeps a devkit decision log (docs/decisions/*.md), every agent is told what is
 * already settled and which sources have already been read, so research is not repeated and a reversal has to be
 * argued as a re-target with new evidence. Used by the swarm launcher (workers, verifier, planner) and by the spawner (recruits).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

export function settledAxes(cwd: string): string {
  const dir = resolve(cwd, "docs", "decisions");
  if (!existsSync(dir)) return "";
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "INDEX.md");
  if (!files.length) return "";
  const rows: string[] = [];
  const sources = new Set<string>();
  for (const f of files) {
    const t = readFileSync(resolve(dir, f), "utf8");
    // a record accumulates Targets; the newest one is the current ruling (the first was injected for a day and said 3+ voters while the hub enforced 2+)
    const blocks = t.split(/\n(?=## Target)/).filter((b) => b.startsWith("## Target"));
    const cur = blocks.length ? blocks[blocks.length - 1] : t;
    const title = /^## Target[^\n]*— ([^\n]+)/m.exec(cur)?.[1] ?? f.replace(/\.md$/, "");
    const ruling = /\*\*(?:Ruling|Decision)[^*]*\*\*:?\s*([^\n]+)/i.exec(cur)?.[1] ?? "";
    rows.push(`- ${f.replace(/\.md$/, "")}: ${title.replace(/\*/g, "").trim()}${ruling ? ` — ${ruling.trim().slice(0, 240)}` : ""}`);
    for (const id of t.match(/arXiv:[a-z-]*\/?[0-9]{4}\.[0-9]{4,5}|arXiv:cs\/[0-9]{7}|10\.[0-9]{4,}\/[^ ),;]+/g) ?? []) sources.add(id.replace(/[.,;:]+$/, "")); // a DOI ending a sentence is the same source without its full stop
  }
  return (
    "SETTLED AXES (this project's decision log, docs/decisions/; do NOT re-research or re-argue these; cite them by slug. " +
    "If you find evidence that contradicts one, say so explicitly as 'RE-TARGET <slug>: <evidence>' rather than silently deciding differently):\n" +
    rows.join("\n") +
    "\n\nSOURCES ALREADY READ (do not re-fetch or re-summarise; new research must add sources not in this list): " +
    [...sources].sort().join(", ") +
    "\n" +
    priorRunSources(resolve(cwd, "swarms"), sources)
  );
}

const SOURCE_ID = /arXiv:\s*([a-z-]*\/?\d{4}\.\d{4,5}|cs\/\d{7})|arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5})|\b(\d{4}\.\d{4,5})(?:v\d+)?\b|\b(10\.\d{4,9}\/[^\s"<>,;)]+)/gi;
/** The newest runs, as PRIOR RUNS lists them (src/swarm.ts priorRuns): a run's report is written when it ends. */
const PRIOR_RUN_COUNT = 6;

/**
 * Sources the prior runs summarised on their boards (sources/* entries in each run's result.json), so the next run reads
 * that summary instead of fetching the paper again. The decision log alone missed most of them: round 1's board cited
 * 33 arXiv ids, 7 reached round 2's list, and round 2 re-fetched 2 of the rest (claim/source-carryover). Ids the
 * decision log already lists are left out; a passing mention outside sources/* is not a read source.
 */
export function priorRunSources(swarmsDir: string, known: ReadonlySet<string> = new Set()): string {
  if (!existsSync(swarmsDir)) return "";
  const seen = new Set([...known].map((s) => s.replace(/^arXiv:/i, "").toLowerCase()));
  const runs = readdirSync(swarmsDir)
    .filter((d) => existsSync(resolve(swarmsDir, d, "report.md")) && existsSync(resolve(swarmsDir, d, "result.json")))
    .map((d) => ({ d, at: statSync(resolve(swarmsDir, d, "report.md")).mtimeMs }))
    .sort((a, b) => b.at - a.at)
    .slice(0, PRIOR_RUN_COUNT);
  const rows: string[] = [];
  for (const { d } of runs) {
    let rooms: { payload?: { board?: Record<string, { text?: string }> } | null }[] = [];
    try { rooms = JSON.parse(readFileSync(resolve(swarmsDir, d, "result.json"), "utf8")).rooms ?? []; } catch { continue; }
    const byKey: string[] = [];
    for (const room of rooms) {
      for (const [key, entry] of Object.entries(room.payload?.board ?? {})) {
        if (!key.startsWith("sources/")) continue;
        const ids = [...String(entry?.text ?? "").matchAll(SOURCE_ID)].map((m) => (m[1] ?? m[2] ?? m[3] ?? m[4]!).replace(/[.]+$/, "").toLowerCase()).filter((id) => !seen.has(id));
        for (const id of ids) seen.add(id);
        if (ids.length) byKey.push(`${[...new Set(ids)].join(", ")} (${key})`);
      }
    }
    if (byKey.length) rows.push(`- ${d}, board in swarms/${d}/result.json: ${byKey.join("; ")}`);
  }
  return rows.length
    ? `\nSOURCES PRIOR RUNS READ (each summarised on that run's board under the key named; read the summary there before fetching the source again):\n${rows.join("\n")}\n`
    : "";
}

