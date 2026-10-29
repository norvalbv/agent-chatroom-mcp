/**
 * How alike a room's sealed openings are at the reveal (item/opening-spread; the owner's question 1, "are we looking at
 * the right thing", read as framing width, not retrieval width). Per room: the openings sealed before openings_revealed
 * (workers, leads and early recruits; verifier, chair and humans excluded unless --all-roles), each embedded once
 * (scripts/embed-cache.ts, Ollama embeddinggemma), then mean and minimum pairwise cosine, the effective rank of the
 * L2-normalised opening matrix (Roy & Vetterli 2007: exp of the entropy of the normalised singular values; n means every
 * opening points its own way, 1 means one direction), and the number of framings at a cut: connected components of the
 * graph joining openings whose cosine is at or above it (single linkage, so a chain of near-copies counts as one).
 * The cut is never a literature number (cosines do not transfer across models): --labels fits it on hand-labelled pairs
 * (same / different / mixed / unknown) by Youden's J and prints the AUROC, and --sample-pairs writes the blind sheet.
 * Seat targets confound spread: since e195b571 (2026-10-10) a flat swarm seat opens on its own item, so rooms are split
 * by target source: item (a flat swarm room with item/* on the board before the reveal), numbered (a flat swarm room after that commit whose
 * brief has a numbered list), none (a swarm room without either) and adhoc (not launched by the swarm script).
 *   npx tsx scripts/opening-spread.ts <room.jsonl | data dir> [...] [--cut 0.8] [--json] [--all-roles] [--min-seats 3]
 *   npx tsx scripts/opening-spread.ts <dirs> --sample-pairs 20 [--seed 7] > sheet.json     (blind: no cosines)
 *   npx tsx scripts/opening-spread.ts <dirs> --labels labelled.json                       (fits the cut, prints AUROC)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { briefSeeds } from "../src/seat-targets.ts";
import { embedTexts } from "./embed-cache.ts";

type Ev = Record<string, any>;
export type TargetSource = "item" | "numbered" | "none" | "adhoc";
export interface Opening { pid: string; name: string; agent: string; role: string; text: string }
export interface RoomOpenings { room: string; created: string; concluded: boolean; targets: TargetSource; openings: Opening[] }
export interface Spread {
  room: string; created: string; concluded: boolean; targets: TargetSource;
  seats: number; mix: string; mean_cos: number; min_cos: number; eff_rank: number; eff_rank_frac: number;
  framings: number | null; one_framing: boolean | null;
  /** Mean cosine over pairs written by the same provider and by different ones: in a mixed room a gap between them is
   * provider style, not framing, unless hand labels say otherwise. Null when the room has no such pair. */
  same_provider_cos: number | null; cross_provider_cos: number | null;
}

/** e195b571 "launcher: each flat seat opens on a distinct item of the brief's numbered list". */
export const SEAT_TARGETS_SINCE = "2026-10-10T08:29:32Z";
const SKIP_ROLES = new Set(["verifier", "chair"]);

/** Pure: the openings a room sealed before its reveal, with who wrote them. A seat that re-submitted keeps its last. */
export function openingsOf(events: Ev[], room = String(events[0]?.room ?? ""), allRoles = false): RoomOpenings {
  const joins = new Map<string, Ev>();
  const sealed = new Map<string, string>();
  let revealed = false, itemBefore = false, concluded = false, created = "", topic = "";
  for (const e of events) {
    if (e.type === "room") { created ||= String(e.createdAt ?? e.ts ?? ""); topic ||= String(e.opts?.topic ?? e.topic ?? ""); }
    if (e.type === "join" && e.p?.id) joins.set(e.p.id, e.p);
    if (e.type === "opening" && !revealed && e.pid) sealed.set(e.pid, String(e.content ?? ""));
    if (e.type === "openings_revealed") revealed = true;
    if (e.type === "board" && !revealed && String(e.key ?? "").startsWith("item/") && String(e.entry?.text ?? "").trim()) itemBefore = true;
    if (e.type === "state" && e.state === "concluded") concluded = true;
  }
  created ||= String(events.find((e) => e.ts)?.ts ?? "");
  const openings = [...sealed].flatMap(([pid, text]) => {
    const p = joins.get(pid) ?? {};
    const role = String(p.role ?? "worker"), agent = String(p.agent ?? "unknown");
    if (!text.trim() || agent === "human" || (!allRoles && SKIP_ROLES.has(role))) return [];
    return [{ pid, name: String(p.name ?? pid), agent, role, text }];
  });
  const swarm = /^swarm-\d{6}-[a-z0-9]{4}-/.test(room);
  const flat = /^swarm-\d{6}-[a-z0-9]{4}-room$/.test(room);
  // the launcher assigns targets to flat seats only (src/swarm.ts TARGETS): a group room's item/* entries are shared, not dealt
  const targets: TargetSource = !swarm ? "adhoc"
    : flat && itemBefore ? "item"
    : flat && created >= SEAT_TARGETS_SINCE && briefSeeds(topic).length >= 2 ? "numbered" : "none";
  return { room, created, concluded, targets, openings };
}

export const cosine = (a: readonly number[], b: readonly number[]) => {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { d += a[i]! * b[i]!; x += a[i]! * a[i]!; y += b[i]! * b[i]!; }
  return d / (Math.sqrt(x * y) || 1);
};

/** Eigenvalues of a small symmetric matrix (cyclic Jacobi). */
export function symEig(m: number[][]): number[] {
  const n = m.length, a = m.map((r) => [...r]);
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p]![q]! ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p]![q]!) < 1e-30) continue;
      const theta = (a[q]![q]! - a[p]![p]!) / (2 * a[p]![q]!);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = a[k]![p]!, akq = a[k]![q]!; a[k]![p] = c * akp - s * akq; a[k]![q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = a[p]![k]!, aqk = a[q]![k]!; a[p]![k] = c * apk - s * aqk; a[q]![k] = s * apk + c * aqk; }
    }
  }
  return a.map((r, i) => r[i]!);
}

/** Effective rank (Roy & Vetterli) of the row-normalised matrix: singular values are the square roots of the Gram
 * matrix's eigenvalues, so the n x n cosine matrix is enough. */
export function effectiveRank(cos: number[][]): number {
  const s = symEig(cos).map((l) => Math.sqrt(Math.max(l, 0)));
  const tot = s.reduce((x, y) => x + y, 0);
  if (!tot) return 0;
  return Math.exp(-s.reduce((h, v) => (v > 0 ? h + (v / tot) * Math.log(v / tot) : h), 0));
}

/** Framings at a cut: connected components joining pairs at or above it. */
export function framingsAt(cos: number[][], cut: number): number {
  const n = cos.length, parent = [...Array(n).keys()];
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (cos[i]![j]! >= cut) parent[find(i)] = find(j);
  return new Set([...Array(n).keys()].map(find)).size;
}

export const mixOf = (agents: readonly string[]) => { const k = [...new Set(agents)].sort(); return k.length === 1 ? k[0]! : `mixed(${k.join("+")})`; };
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Pure: one room's spread from its openings' vectors. */
export function spreadOf(r: RoomOpenings, vecs: number[][], cut?: number): Spread {
  const n = vecs.length;
  const cos = vecs.map((a) => vecs.map((b) => cosine(a, b)));
  const pairs: number[] = [], same: number[] = [], cross: number[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    pairs.push(cos[i]![j]!);
    (r.openings[i]?.agent === r.openings[j]?.agent ? same : cross).push(cos[i]![j]!);
  }
  const mean = (xs: number[]) => (xs.length ? r3(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
  const er = effectiveRank(cos);
  const framings = cut === undefined ? null : framingsAt(cos, cut);
  return {
    room: r.room, created: r.created, concluded: r.concluded, targets: r.targets, seats: n, mix: mixOf(r.openings.map((o) => o.agent)),
    mean_cos: r3(pairs.reduce((s, x) => s + x, 0) / (pairs.length || 1)), min_cos: r3(Math.min(...pairs)),
    eff_rank: r3(er), eff_rank_frac: r3(er / (n || 1)), framings, one_framing: framings === null ? null : framings === 1,
    same_provider_cos: mean(same), cross_provider_cos: mean(cross),
  };
}

export interface Label { room: string; a: string; b: string; label: "same" | "different" | "competing" | "complementary" | "mixed" | "unknown" }
/** Not one framing: rival answers to the same question (competing) or different sub-areas (complementary). Text
 * similarity cannot tell those two apart, so the cut is fitted on same against either. */
const DIFFERENT = new Set(["different", "competing", "complementary"]);

/** Fit the cut on labelled pairs: same=1, different/competing/complementary=0; mixed and unknown are left out. Youden's J picks the threshold;
 * AUROC is the chance a random same pair scores above a random different one (ties half). */
export function fitCut(scored: { cos: number; label: Label["label"] }[]) {
  const xs = scored.filter((s) => s.label === "same" || DIFFERENT.has(s.label));
  const pos = xs.filter((s) => s.label === "same").map((s) => s.cos), neg = xs.filter((s) => DIFFERENT.has(s.label)).map((s) => s.cos);
  let auc = 0;
  for (const p of pos) for (const q of neg) auc += p > q ? 1 : p === q ? 0.5 : 0;
  auc = pos.length && neg.length ? auc / (pos.length * neg.length) : NaN;
  let best = { cut: NaN, j: -Infinity, tpr: NaN, fpr: NaN };
  for (const c of [...new Set(xs.map((s) => s.cos))].sort((a, b) => a - b)) {
    const tpr = pos.filter((p) => p >= c).length / (pos.length || 1), fpr = neg.filter((q) => q >= c).length / (neg.length || 1);
    if (tpr - fpr > best.j) best = { cut: c, j: tpr - fpr, tpr, fpr };
  }
  return { n_same: pos.length, n_different: neg.length, auroc: r3(auc), cut: r3(best.cut), youden_j: r3(best.j), tpr: r3(best.tpr), fpr: r3(best.fpr) };
}

/** Seeded pair sample for the blind sheet: one pair from each of `k` distinct rooms. */
export function samplePairs(rooms: RoomOpenings[], k: number, seed = 7) {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const pool = [...rooms].sort((a, b) => a.room.localeCompare(b.room));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j]!, pool[i]!]; }
  return pool.slice(0, k).map((r) => {
    const i = Math.floor(rnd() * r.openings.length);
    let j = Math.floor(rnd() * (r.openings.length - 1)); if (j >= i) j++;
    const [a, b] = [r.openings[i]!, r.openings[j]!];
    return { room: r.room, a: a.pid, b: b.pid, text_a: a.text, text_b: b.text, label: "" };
  });
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : NaN; };
const band = (n: number) => (n <= 3 ? "3" : n <= 5 ? "4-5" : "6+");

export function summarise(rows: Spread[]) {
  const groups = new Map<string, Spread[]>();
  const add = (k: string, r: Spread) => groups.set(k, [...(groups.get(k) ?? []), r]);
  for (const r of rows) {
    add("all", r); add(`targets=${r.targets}`, r); add(`seats=${band(r.seats)}`, r);
    add(`mix=${r.mix.startsWith("mixed") ? "mixed" : r.mix}`, r); add(`concluded=${r.concluded}`, r);
  }
  return [...groups].map(([group, rs]) => ({
    group, n: rs.length, median_mean_cos: r3(median(rs.map((r) => r.mean_cos))), median_eff_rank_frac: r3(median(rs.map((r) => r.eff_rank_frac))),
    median_framings_frac: rs[0]!.framings === null ? null : r3(median(rs.map((r) => r.framings! / r.seats))),
    one_framing: rs[0]!.framings === null ? null : rs.filter((r) => r.one_framing).length,
    median_same_minus_cross: (() => { const g = rs.filter((r) => r.same_provider_cos !== null && r.cross_provider_cos !== null).map((r) => r.same_provider_cos! - r.cross_provider_cos!); return g.length ? r3(median(g)) : null; })(),
  }));
}

function loadRooms(paths: string[], allRoles: boolean, minSeats: number): RoomOpenings[] {
  const files = paths.flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith(".jsonl")).map((f) => join(p, f)) : [p]));
  return files.flatMap((file) => {
    const events = readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
    if (!events.some((e) => e.type === "room") || !events.some((e) => e.type === "openings_revealed")) return [];
    const r = openingsOf(events, basename(file, ".jsonl"), allRoles);
    return r.openings.length >= minSeats ? [r] : [];
  });
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const valued = new Set(["--cut", "--min-seats", "--sample-pairs", "--seed", "--labels", "--model"]);
  const paths = args.filter((a, i) => !a.startsWith("--") && !valued.has(args[i - 1] ?? ""));
  if (!paths.length) { console.error("usage: opening-spread <room.jsonl | data dir> [...] [--cut c] [--json] [--all-roles] [--min-seats 3] [--sample-pairs k --seed s] [--labels file]"); process.exit(2); }
  const model = opt("--model") ?? "embeddinggemma";
  const rooms = loadRooms(paths, args.includes("--all-roles"), Number(opt("--min-seats") ?? 3));
  if (opt("--sample-pairs")) { console.log(JSON.stringify(samplePairs(rooms, Number(opt("--sample-pairs")), Number(opt("--seed") ?? 7)), null, 1)); return; }
  if (opt("--labels")) {
    const labels = JSON.parse(readFileSync(opt("--labels")!, "utf8")) as (Label & { text_a?: string; text_b?: string })[];
    const byRoom = new Map(rooms.map((r) => [r.room, r]));
    const scored = [];
    for (const l of labels) {
      const r = byRoom.get(l.room), a = r?.openings.find((o) => o.pid === l.a), b = r?.openings.find((o) => o.pid === l.b);
      if (!a || !b) { console.error(`no openings for ${l.room} ${l.a} ${l.b}`); continue; }
      const [va, vb] = await embedTexts([a.text, b.text], { model });
      scored.push({ room: l.room, a: l.a, b: l.b, label: l.label, cos: r3(cosine(va!, vb!)) });
    }
    console.log(JSON.stringify({ model, pairs: scored, fit: fitCut(scored) }, null, 1));
    return;
  }
  const cut = opt("--cut") === undefined ? undefined : Number(opt("--cut"));
  const rows: Spread[] = [];
  for (const r of rooms) rows.push(spreadOf(r, await embedTexts(r.openings.map((o) => o.text), { model }), cut));
  const summary = summarise(rows);
  if (args.includes("--json")) { console.log(JSON.stringify({ model, cut: cut ?? null, rooms: rows, summary }, null, 1)); return; }
  console.log(`opening-spread: ${rows.length} rooms with >= ${opt("--min-seats") ?? 3} sealed openings, model ${model}, cut ${cut ?? "none"}`);
  for (const s of summary) console.log(`  ${s.group.padEnd(28)} n=${String(s.n).padStart(3)}  median mean cos ${s.median_mean_cos}  median eff rank/n ${s.median_eff_rank_frac}` + (s.one_framing === null ? "" : `  median framings/n ${s.median_framings_frac}  one framing ${s.one_framing}/${s.n}`) + (s.median_same_minus_cross === null ? "" : `  same-minus-cross-provider cos ${s.median_same_minus_cross}`));
}

if (process.argv[1] && /^opening-spread\.[cm]?[jt]s$/.test(basename(process.argv[1]))) main().catch((e) => { console.error(e); process.exit(1); });
