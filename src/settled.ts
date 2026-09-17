/**
 * Settled axes: if the target project keeps a devkit decision log (docs/decisions/*.md), every agent is told what is
 * already settled and which sources have already been read, so research is not repeated and a reversal has to be
 * argued as a re-target with new evidence. Used by the swarm launcher (workers, verifier, planner) and by the spawner (recruits).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
    for (const id of t.match(/arXiv:[a-z-]*\/?[0-9]{4}\.[0-9]{4,5}|arXiv:cs\/[0-9]{7}|10\.[0-9]{4,}\/[^ ),;]+/g) ?? []) sources.add(id);
  }
  return (
    "SETTLED AXES (this project's decision log, docs/decisions/; do NOT re-research or re-argue these; cite them by slug. " +
    "If you find evidence that contradicts one, say so explicitly as 'RE-TARGET <slug>: <evidence>' rather than silently deciding differently):\n" +
    rows.join("\n") +
    "\n\nSOURCES ALREADY READ (do not re-fetch or re-summarise; new research must add sources not in this list): " +
    [...sources].sort().join(", ") +
    "\n"
  );
}

