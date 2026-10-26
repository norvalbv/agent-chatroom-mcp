/**
 * Settled axes: if the target project keeps a devkit decision log (docs/decisions/*.md), every agent is told what is
 * already settled and which sources have already been read, so research is not repeated and a reversal has to be
 * argued as a re-target with new evidence. Used by the swarm launcher (workers, verifier, planner) and by the spawner (recruits).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { refsIn } from "./telemetry/source-refs.js";

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
    // repos and packages too (refsIn): the list knew arXiv ids and DOIs only, so a repo a room had read never reached the next (inputs/owner-4)
    for (const id of refsIn(t)) sources.add(id);
  }
  // records the launcher saved but nobody has promoted yet (RSI-3 and RSI-4 sat there): not settled, so not axes, but read
  const proposed = resolve(dir, "proposed");
  if (existsSync(proposed)) for (const f of readdirSync(proposed).filter((f) => f.endsWith(".md"))) for (const id of refsIn(readFileSync(resolve(proposed, f), "utf8"))) sources.add(id);
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

/**
 * What a seat was told was already settled and read, as the room log records it (the `carried` event: Hub.recordCarried,
 * from the launcher and from the spawner): the outside ids in the text (refsIn), how many settled axes it listed, and its
 * length. Without it the log could not show whether the list works: a NO_CARRY arm looked like a run that had it.
 */
export function carriedSummary(text: string): { ids: string[]; axes: number; chars: number } {
  const t = String(text ?? "");
  const axes = t.slice(t.indexOf("SETTLED AXES"), t.includes("SOURCES ALREADY READ") ? t.indexOf("SOURCES ALREADY READ") : undefined);
  return { ids: refsIn(t), axes: t.includes("SETTLED AXES") ? (axes.match(/^- \S/gm) ?? []).length : 0, chars: t.length };
}

/** How the hub records what a recruit was told (registerLaunchReports, src/telemetry/launch-reports.ts); unset outside a hub. */
let recordTold: ((room: string, seats: string[], text: string) => void) | undefined;
export function onTold(record: typeof recordTold): void { recordTold = record; }

/** settledAxes for recruits' briefs (src/spawner.ts), recorded as their carried event when a hub is listening (onTold). */
export function toldSettled(home: string, room: string, seats: string[]): string {
  const text = settledAxes(home);
  try { recordTold?.(room, seats, text); } catch {} // telemetry never stops a spawn
  return text;
}

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
  const seen = new Set(known);
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
        // the key too: sources/2510.09462 names its paper even when the text only says "read again here"
        const ids = refsIn(`${key.slice("sources/".length)} ${String(entry?.text ?? "")}`).filter((id) => !seen.has(id));
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

