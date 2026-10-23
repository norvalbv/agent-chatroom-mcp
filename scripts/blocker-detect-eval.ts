/**
 * Scores the two chat blocker detectors against hand labels (decision/blocker-detection, inputs/owner-3): the word list
 * (blockerTerm) and an embedding check against the pre-registered examples (scripts/blocker-examples.ts,
 * 62000f24). Labels are one line per agent chat message, "<seq> yes|no" (bench/labels-<room>); unlabelled messages are
 * skipped. With --cut the embedding uses that margin; without, it prints the precision/recall at every cut, which is
 * how a cut is fitted on a dev log and only then applied, unchanged, to a held-out one.
 *
 * CHATROOM_EMBED_URL=http://127.0.0.1:11434/api/embed npx tsx scripts/blocker-detect-eval.ts <room.jsonl> <labels.txt> [--cut 0.02]
 */
import { readFileSync } from "node:fs";
import { BLOCKER_NO, BLOCKER_YES } from "./blocker-examples.js";

// The word list the hub used from 0d659f43 to bb5e6028, kept here only as the baseline it was measured as (removed from
// src/ after inputs/owner-3 and decision/blocker-detection).
const OUTSIDE = /\b(laptop|this machine|our machine|the machine|vpn|nordvpn|colocat\w*|co-locat\w*|vps|server(?![-\s]?(?:ts|timestamps?|time|clock|stamps?|side)\b)(?!'s)|latency|rtt|load average|geoblock\w*|restricted region|region rule|feed lag|slow consumer|rate[- ]?limit\w*)\b/i;
const BLOCKING = /\b(bottleneck|too slow|can'?t|cannot|only (?:worth|works|possible)|territory|need(?:s|ed)? (?:a|an) (?:server|vps|colocat\w*|host|box|feed)|blocks|blocked|blocking|invalidat\w*|out of reach|unreachable|not a laptop|unfixable|nothing we can|(?:is|was) the (?:cause|problem|bottleneck|limit)|the cause is|caused by|los(?:es|e|ing) the race|fixes neither|paid item|needs\/ decision)\b/i;
const ELSEWHERE = /\b(swarm-\d{6}-[a-z0-9]{4})\b|\b(lc0a|mrw4)\b|\breview\//gi;
function blockerTerm(content: string, room = ""): string | undefined {
  const outside = OUTSIDE.exec(content);
  if (!outside || !BLOCKING.test(content)) return undefined;
  for (const m of content.matchAll(ELSEWHERE)) if (!room.toLowerCase().includes((m[1] ?? m[2] ?? m[0]).toLowerCase())) return undefined;
  return outside[0];
}

const [logPath, labelPath, ...rest] = process.argv.slice(2);
if (!logPath || !labelPath) { console.error("usage: blocker-detect-eval.ts <room.jsonl> <labels.txt> [--cut x]"); process.exit(2); }
const cutArg = rest.indexOf("--cut") >= 0 ? Number(rest[rest.indexOf("--cut") + 1]) : undefined;
const url = process.env.CHATROOM_EMBED_URL ?? "http://127.0.0.1:11434/api/embed", model = process.env.CHATROOM_EMBED_MODEL ?? "embeddinggemma";
const room = logPath.split("/").pop()!.replace(/\.jsonl$/, "");

const labels = new Map<number, boolean>();
for (const line of readFileSync(labelPath, "utf8").split("\n")) {
  const m = /^\s*#?(\d+)\s+(yes|no)\b/i.exec(line);
  if (m) labels.set(Number(m[1]), m[2]!.toLowerCase() === "yes");
}
const msgs: { seq: number; content: string; yes: boolean }[] = [];
for (const line of readFileSync(logPath, "utf8").split("\n")) {
  let e: { type?: string; msg?: { seq: number; kind: string; content: string; from: { name: string; agent?: string } } };
  try { e = JSON.parse(line); } catch { continue; }
  const m = e.msg;
  if (e.type !== "message" || !m || m.kind !== "chat" || m.from.name === "system" || m.from.agent === "human" || !labels.has(m.seq)) continue;
  msgs.push({ seq: m.seq, content: m.content, yes: labels.get(m.seq)! });
}

async function embed(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 32) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, input: texts.slice(i, i + 32).map((t) => t.slice(0, 2000)) }) });
    if (!r.ok) throw new Error(`embed ${r.status}`);
    out.push(...((await r.json()) as { embeddings: number[][] }).embeddings);
  }
  return out;
}
const cos = (a: number[], b: number[]) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i]! * b[i]!; x += a[i]! ** 2; y += b[i]! ** 2; } return d / Math.sqrt(x * y); };

function score(name: string, flagged: boolean[]) {
  const tp = msgs.filter((m, i) => flagged[i] && m.yes).length, fp = flagged.filter((f, i) => f && !msgs[i]!.yes).length;
  const pos = msgs.filter((m) => m.yes).length;
  console.log(`${name}: flagged ${tp + fp}, true ${tp}, precision ${tp + fp ? (tp / (tp + fp)).toFixed(2) : "n/a"}, recall ${pos ? (tp / pos).toFixed(2) : "n/a"} (${tp}/${pos})`);
}

console.log(`${room}: ${msgs.length} labelled agent chat messages, ${msgs.filter((m) => m.yes).length} yes`);
score("word list", msgs.map((m) => !!blockerTerm(m.content, room)));
const [ys, ns, ms] = await Promise.all([embed(BLOCKER_YES), embed(BLOCKER_NO), embed(msgs.map((m) => m.content))]);
const margin = ms.map((v) => Math.max(...ys.map((y) => cos(v, y))) - Math.max(...ns.map((n) => cos(v, n))));
if (cutArg !== undefined) score(`embedding ${model} margin >= ${cutArg}`, margin.map((s) => s >= cutArg));
else for (const c of [-0.04, -0.02, 0, 0.02, 0.04, 0.06, 0.08, 0.1]) score(`embedding ${model} margin >= ${c}`, margin.map((s) => s >= c));
if (rest.includes("--show")) for (const [i, m] of msgs.entries()) console.log(`  #${m.seq} ${m.yes ? "YES" : "no "} ${margin[i]!.toFixed(3)} ${m.content.replace(/\s+/g, " ").slice(0, 110)}`);
