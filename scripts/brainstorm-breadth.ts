/**
 * How wide a room looked before it narrowed, and what it did with the alternatives it had (decision/opening-alternatives).
 * Per room record: minutes from the first event to the first claim/*, idea/* written before that claim, idea/* seeded
 * from sealed openings (openings_revealed.ideas_seeded), all idea/*, the ones ADDRESSED at any point in the log (a
 * claim/<slug> or a claim naming the exact key, an attack/idea/<slug>, or the idea once settled "dropped:/done:/tested:"),
 * the ones NEVER addressed, and how many of those the conclusion names. The seeded count is what the build writes;
 * "addressed" is textual attention (a claim saying "do not test idea/x" counts), not proof an idea was tested, and an idea
 * reopened after it was settled still counts as addressed (6-astra-4's review of e629cbba).
 * Baseline over MAIN/data before this change: 2 of 137 claimed rooms had an idea/* before their first claim; 17 of 80
 * ideas addressed (evidence/brainstorm-replay-200).
 *   npx tsx scripts/brainstorm-breadth.ts <room.jsonl | data dir> [...] [--json] [--concluded]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

export interface Breadth {
  room: string;
  concluded: boolean;
  min_to_first_claim: number | null;
  ideas_before_first_claim: number;
  ideas_seeded: number;
  ideas: number;
  addressed: number;
  never_addressed: number;
  never_addressed_named: number;
}

const SETTLED = /^\s*(dropped|done|tested|rejected|refuted)\s*:/i;
const minutes = (a: string, b: string) => Math.round(((Date.parse(b) - Date.parse(a)) / 60000) * 10) / 10;
type Ev = Record<string, any>;
const tsOf = (e: Ev): string | undefined => e.ts ?? e.msg?.ts ?? e.entry?.updatedAt ?? e.p?.joinedAt;

/** Pure: one room's row from its events in log order. */
export function breadth(events: Ev[], room = String(events[0]?.room ?? "")): Breadth {
  let start: string | undefined, firstClaim: string | undefined, conclusion: string | undefined;
  const ideaFirst = new Map<string, string>();
  let seeded: string[] = [];
  // the whole history, not the final board: a claim cleared once its work landed still addressed its idea
  const everLive = new Set<string>(), settled = new Set<string>(), claimTexts: string[] = [];
  for (const e of events) {
    const ts = tsOf(e);
    start ??= ts;
    // only "board" carries the entry; board_edit and board_append are telemetry with no text (src/hub/internal.ts)
    if (e.type === "board") {
      const key = String(e.key ?? ""), text = String(e.entry?.text ?? "");
      if (text.trim()) everLive.add(key);
      if (key.startsWith("claim/") && text.trim()) { firstClaim ??= e.entry?.updatedAt ?? ts; claimTexts.push(text); }
      if (key.startsWith("idea/") && text.trim() && !ideaFirst.has(key)) ideaFirst.set(key, e.entry?.updatedAt ?? ts ?? "");
      if (key.startsWith("idea/") && SETTLED.test(text)) settled.add(key);
    }
    if (e.type === "openings_revealed" && Array.isArray(e.ideas_seeded)) seeded = e.ideas_seeded;
    if (e.type === "state" && e.state === "concluded") conclusion = String(e.conclusion?.text ?? "");
  }
  // every idea ever written: one attacked, conceded and cleared before the end was addressed, not absent
  const ideas = [...ideaFirst.keys()];
  // a key named as itself: idea/a is not named by idea/ab, idea/a-2 or idea/a/b; a sentence-final period still names it
  const names = (text: string, k: string) => new RegExp(`(^|[^\\w./-])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w/-]|\\.\\w)`).test(text);
  /** Acted on, as the record shows it at any point: settled with a label, claim/<slug> written, a claim naming the key
   * exactly, or attack/<key> written. A textual record of attention, not proof the idea was tested. */
  const acted = (k: string) => settled.has(k) || everLive.has(`claim/${k.slice(5)}`) || claimTexts.some((t) => names(t, k)) || everLive.has(`attack/${k}`);
  const addressed = ideas.filter(acted);
  const open = ideas.filter((k) => !acted(k));
  return {
    room, concluded: conclusion !== undefined,
    min_to_first_claim: start && firstClaim ? minutes(start, firstClaim) : null,
    ideas_before_first_claim: firstClaim ? [...ideaFirst.values()].filter((t) => t && t < firstClaim!).length : ideaFirst.size,
    ideas_seeded: seeded.length,
    ideas: ideas.length,
    addressed: addressed.length,
    never_addressed: open.length,
    never_addressed_named: conclusion ? open.filter((k) => conclusion!.includes(k) || conclusion!.includes(k.slice(5))).length : 0,
  };
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json"), onlyConcluded = args.includes("--concluded");
  const files = args.filter((a) => !a.startsWith("--")).flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith(".jsonl")).map((f) => join(p, f)) : [p]));
  if (!files.length) { console.error("usage: brainstorm-breadth <room.jsonl | data dir> [...] [--json] [--concluded]"); process.exit(2); }
  const rows: Breadth[] = [];
  for (const file of files) {
    const events = readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
    if (!events.some((e) => e.type === "room")) continue;
    const row = breadth(events, basename(file, ".jsonl"));
    if (!onlyConcluded || row.concluded) rows.push(row);
  }
  if (json) { console.log(JSON.stringify(rows, null, 1)); return; }
  const n = rows.length, sum = (f: (r: Breadth) => number) => rows.reduce((s, r) => s + f(r), 0);
  const mins = rows.map((r) => r.min_to_first_claim).filter((m): m is number => m !== null).sort((a, b) => a - b);
  const claimed = rows.filter((r) => r.min_to_first_claim !== null);
  console.log(`rooms ${n} (${claimed.length} with a claim); of those, with an idea/* before the first claim ${claimed.filter((r) => r.ideas_before_first_claim > 0).length}; with seeded ideas ${rows.filter((r) => r.ideas_seeded > 0).length}; ` +
    `median minutes to first claim ${mins.length ? mins[Math.floor(mins.length / 2)] : "-"} (n=${mins.length})`);
  console.log(`idea/* ${sum((r) => r.ideas)} (seeded ${sum((r) => r.ideas_seeded)}); addressed (textual) ${sum((r) => r.addressed)}; never addressed ${sum((r) => r.never_addressed)}, of those named in the conclusion ${sum((r) => r.never_addressed_named)}`);
  for (const r of rows.filter((r) => r.ideas || r.ideas_seeded)) console.log(`  ${r.room}: first claim ${r.min_to_first_claim ?? "-"} min, before ${r.ideas_before_first_claim}, seeded ${r.ideas_seeded}, ideas ${r.ideas}, addressed ${r.addressed}, never addressed ${r.never_addressed} (named ${r.never_addressed_named})`);
}

if (process.argv[1] && /^brainstorm-breadth\.[cm]?[jt]s$/.test(basename(process.argv[1]))) main();
