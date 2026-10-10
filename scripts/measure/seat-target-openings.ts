/** Opening collapse with and without seat targets (src/seat-targets.ts), as a proxy: each of N seats gets the flat
 * prompt the launcher would build (minimal.md, no carry) and writes only its opening, with no tools and no room. A blind
 * judge, told nothing about arms, maps each opening to one item of the brief's list (or "other"). Per synthetic room:
 * the largest cluster and the number of distinct areas.
 *   npx tsx scripts/measure/seat-target-openings.ts <topic-file> [--seats 7] [--reps 2] [--model claude-opus-5-5] [--out file]
 * Calls real models (about $0.02-0.05 each). Proxy only: real seats read the repo before opening. */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { briefSeeds, seatTarget } from "../../src/seat-targets.ts";

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const topic = readFileSync(args[0], "utf8");
const SEATS = Number(opt("seats", "7")), REPS = Number(opt("reps", "2")), MODEL = opt("model", "claude-opus-5-5");
const LENSES = ["reproduce and measure before theorising", "the simplest fix that could work", "what could go wrong with the obvious fix", "what the tests and history say", "the maintainer who inherits this in a year"];
const minimal = readFileSync(join(import.meta.dirname, "..", "..", "prompts", "minimal.md"), "utf8");
const seeds = briefSeeds(topic);
if (!seeds.length) throw new Error("topic has no numbered list");

function claude(prompt: string): Promise<{ text: string; cost: number }> {
  return new Promise((ok, fail) => {
    const c = spawn("claude", ["-p", "--model", MODEL, "--tools", "", "--output-format", "json"], { cwd: tmpdir(), stdio: ["pipe", "pipe", "inherit"] });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.on("close", () => { try { const j = JSON.parse(out); ok({ text: String(j.result), cost: Number(j.total_cost_usd ?? 0) }); } catch (e) { fail(new Error(`bad output: ${out.slice(0, 300)}`)); } });
    c.stdin.end(prompt);
  });
}

function seatPrompt(i: number, on: boolean): string {
  const name = `claude-opus-5-5-${i}`;
  const body = minimal.replaceAll("{{NAME}}", name).replaceAll("{{N}}", String(SEATS + 1)).replaceAll("{{ROOM}}", "measure-room").replaceAll("{{TOPIC}}", topic).replaceAll("{{AGENT}}", "claude");
  const target = on ? `\n${seatTarget(topic, i, LENSES)}` : "";
  return `${body}${target}\n\nThis is a dry run: there is no room and you have no tools. Write ONLY the opening you would submit with submit_opening (under 400 characters: the area you take and why), nothing else.`;
}

async function pool<T>(jobs: (() => Promise<T>)[], n = 4): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < jobs.length) { const k = next++; out[k] = await jobs[k](); } }));
  return out;
}

const rooms: { arm: string; rep: number; openings: string[] }[] = [];
for (let rep = 1; rep <= REPS; rep++) for (const arm of ["off", "on"]) rooms.push({ arm, rep, openings: [] });
let cost = 0;
const jobs = rooms.flatMap((r) => Array.from({ length: SEATS }, (_, k) => async () => { const o = await claude(seatPrompt(k + 1, r.arm === "on")); cost += o.cost; r.openings[k] = o.text.trim(); }));
await pool(jobs);

// blind judge: all openings shuffled together, no arm labels
const all = rooms.flatMap((r, ri) => r.openings.map((t, k) => ({ id: `${ri}-${k}`, t })));
const shuffled = [...all].sort((a, b) => (a.id.split("").reverse().join("") < b.id.split("").reverse().join("") ? -1 : 1));
const labels = ["other", ...seeds.map((s, i) => `${i + 1}`)];
const judgePrompt = `Classify each opening by the ONE item of this numbered list it mainly takes as its area, or "other" if it mainly takes something the list does not name.\n${seeds.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\nAnswer with only a JSON object mapping each id to one of ${JSON.stringify(labels)}.\n\n${shuffled.map((o) => `id ${o.id}: ${o.t.replace(/\s+/g, " ")}`).join("\n")}`;
const j = await claude(judgePrompt);
cost += j.cost;
const cls = JSON.parse(/\{[^]*\}/.exec(j.text)![0]) as Record<string, string>;

const summary = rooms.map((r, ri) => {
  const areas = r.openings.map((_, k) => cls[`${ri}-${k}`] ?? "?");
  const counts: Record<string, number> = {};
  for (const a of areas) counts[a] = (counts[a] ?? 0) + 1;
  return { arm: r.arm, rep: r.rep, areas, largest_cluster: Math.max(...Object.values(counts)), distinct_areas: Object.keys(counts).length };
});
const result = { model: MODEL, seats: SEATS, reps: REPS, seeds, cost_usd: Number(cost.toFixed(3)), summary, rooms };
writeFileSync(opt("out", join(tmpdir(), `seat-target-openings-${Date.now()}.json`)), JSON.stringify(result, null, 2));
for (const s of summary) console.log(`${s.arm} rep${s.rep}: largest cluster ${s.largest_cluster}/${SEATS}, distinct areas ${s.distinct_areas}  [${s.areas.join(" ")}]`);
console.log(`cost $${result.cost_usd}`);
