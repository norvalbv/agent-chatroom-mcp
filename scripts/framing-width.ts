/**
 * How many distinct framings a room holds over time, when it falls to one, and whether that came before its first evidence
 * (item/width-and-collapse; the rule was registered as decision/width-rule before any number was computed).
 * A framing statement is a seat's opening, its own idea/draft/position/decision/design/hypothesis/plan entry, a proposal or
 * amend text it wrote, or an agree vote (the voter now holds the proposal's current text). claim/take/evidence/result are
 * work areas and evidence, not framings: seat targets hand out items at launch, so a claim is not a hypothesis.
 * HELD width at time t = distinct framing labels among each present seat's latest statement; BOARD width adds idea/* entries
 * not cleared or settled. Labels come from hand labels (--labels) or from average-linkage clustering of embeddings at a cut.
 * minutes_to_one is the exact time after which held width stays <= 1 to the end; collapse_before_evidence compares it with
 * the first checkable evidence (result/evidence/findings/verify entry, check or review event: decision/door's primary proxy;
 * a chat passage with an observation also counts there and this script cannot see it, so its D2 is an upper bound) and,
 * as a sensitivity, the first run|web invocation in the work ledger.
 *   npx tsx scripts/framing-width.ts --dump <room.jsonl> [--stage reveal|chrono|all] [--messages]   statements, no clusters
 *   npx tsx scripts/framing-width.ts <room.jsonl | data dir> [...] [--labels labels.json] [--cut 0.x] [--centre] [--json]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

type Ev = Record<string, any>;
export type Source = "opening" | "board" | "idea" | "proposal" | "amend" | "vote";
export interface Stmt { i: number; ts: string; seat: string; source: Source; key?: string; text: string; adopts?: number }
export interface Extract {
  room: string; t0: string; end: string; itemized: boolean;
  stmts: Stmt[];
  leaves: { seat: string; ts: string }[];
  settled: { key: string; ts: string }[];
  first_evidence: string | null; first_evidence_ref: string | null;
  first_invocation: string | null;
  conclusion_proposal: string | null;
}

const POSITION = /^(draft|position|decision|design|hypothesis|plan)\//;
const EVIDENCE = /^(result|evidence|findings|verify)\//;
const SETTLED = /^\s*(dropped|done|tested|rejected|refuted)\s*:/i;
const tsOf = (e: Ev): string | undefined => e.ts ?? e.msg?.ts ?? e.entry?.updatedAt ?? e.updatedAt ?? e.proposal?.createdAt ?? e.entry?.ts ?? e.p?.joinedAt;
export const minutes = (a: string, b: string) => Math.round(((Date.parse(b) - Date.parse(a)) / 60000) * 10) / 10;

/** Pure: the framing statements of one room, in log order, with the times the width rule needs. */
export function extract(events: Ev[], room = String(events[0]?.room ?? "")): Extract {
  const nameToSeat = new Map<string, string>(), excluded = new Set<string>(["launcher", "system", "hub"]);
  for (const e of events) if (e.type === "join" && e.p) {
    nameToSeat.set(String(e.p.name), String(e.p.id));
    if (e.p.role === "chair" || e.p.agent === "human") { excluded.add(String(e.p.id)); excluded.add(String(e.p.name)); }
  }
  const stmts: Stmt[] = [], leaves: Extract["leaves"] = [], settled: Extract["settled"] = [];
  const proposalStmt = new Map<string, number>();
  let last: string | undefined, start: string | undefined, reveal: string | undefined, firstOpening: string | undefined;
  let firstEvidence: string | null = null, firstEvidenceRef: string | null = null, firstInvocation: string | null = null;
  let end: string | undefined, concluded: string | null = null, itemized = false;
  const openings: { seat: string; text: string }[] = [];
  const push = (s: Omit<Stmt, "i">) => { stmts.push({ ...s, i: stmts.length }); return stmts.length - 1; };
  const evidence = (ts: string | undefined, ref: string) => { if (ts && !firstEvidence) { firstEvidence = ts; firstEvidenceRef = ref; } };
  for (const e of events) {
    const ts = tsOf(e) ?? last;
    if (ts) last = ts;
    start ??= ts;
    if (e.type === "room" && /Your starting area|item\/[\w-]+/.test(String(e.opts?.topic ?? ""))) itemized = true;
    if (e.type === "opening" && !excluded.has(String(e.pid))) { firstOpening ??= ts; openings.push({ seat: String(e.pid), text: String(e.content ?? "") }); }
    if (e.type === "openings_revealed") reveal ??= ts;
    if (e.type === "leave" && e.p?.id && ts) leaves.push({ seat: String(e.p.id), ts });
    if (e.type === "work" && (e.cls === "run" || e.cls === "web") && ts) firstInvocation ??= ts;
    if ((e.type === "check" || e.type === "review") && ts) evidence(ts, `${e.type}`);
    if (e.type === "board") {
      const key = String(e.key ?? ""), text = String(e.entry?.text ?? ""), by = String(e.entry?.by ?? "");
      const when = e.entry?.updatedAt ?? ts;
      if (key.startsWith("item/")) itemized = true;
      if (EVIDENCE.test(key) && text.trim()) evidence(when, key);
      if (excluded.has(by)) continue;
      const seat = nameToSeat.get(by) ?? by;
      if (key.startsWith("idea/")) {
        if (!text.trim() || SETTLED.test(text)) settled.push({ key, ts: when });
        else push({ ts: when, seat, source: "idea", key, text });
      } else if (POSITION.test(key) && text.trim()) push({ ts: when, seat, source: "board", key, text });
    }
    if (e.type === "proposal" && e.proposal) {
      const p = e.proposal;
      proposalStmt.set(String(p.id), push({ ts: p.createdAt ?? ts, seat: String(p.by?.id ?? ""), source: "proposal", key: String(p.id), text: String(p.text ?? "") }));
    }
    if (e.type === "amend" && e.proposalId) {
      const prev = proposalStmt.get(String(e.proposalId));
      const seat = prev !== undefined ? stmts[prev].seat : "";
      proposalStmt.set(String(e.proposalId), push({ ts: e.updatedAt ?? ts, seat, source: "amend", key: String(e.proposalId), text: String(e.text ?? "") }));
    }
    if (e.type === "vote" && e.entry?.vote === "agree" && !excluded.has(String(e.pid))) {
      const p = proposalStmt.get(String(e.proposalId));
      if (p !== undefined && stmts[p].seat !== String(e.pid)) push({ ts: e.entry.ts ?? ts, seat: String(e.pid), source: "vote", key: String(e.proposalId), text: stmts[p].text, adopts: p });
    }
    if (e.type === "state" && e.state === "concluded") { end ??= e.conclusion?.decidedAt ?? ts; concluded ??= String(e.conclusion?.proposalId ?? ""); }
  }
  // openings carry no ts: they are all revealed at once, so they are stated at the reveal
  const t0 = reveal ?? firstOpening ?? start ?? "";
  const opened: Omit<Stmt, "i">[] = openings.map((o) => ({ ts: t0, seat: o.seat, source: "opening", text: o.text }));
  const all: Omit<Stmt, "i">[] = [...opened, ...stmts.map(({ i: _i, ...s }) => s)];
  // re-index after placing openings first, keeping vote -> proposal links
  const shift = opened.length;
  const ordered: Stmt[] = all.map((s, i) => ({ ...s, i, ...(s.adopts !== undefined ? { adopts: s.adopts + shift } : {}) }));
  return {
    room, t0, end: end ?? last ?? t0, itemized, stmts: ordered, leaves, settled,
    first_evidence: firstEvidence, first_evidence_ref: firstEvidenceRef, first_invocation: firstInvocation,
    conclusion_proposal: concluded,
  };
}

export interface Width {
  room: string; itemized: boolean; statements: number; seats: number;
  held_at_reveal: number; board_at_reveal: number; max_held: number;
  curve: { min: number; held: number; board: number }[];
  never_wide: boolean;
  minutes_to_one: number | null;          // null: held width never settles at <= 1 (still wide at the end)
  first_evidence_min: number | null; first_evidence_ref: string | null;
  first_invocation_min: number | null;
  collapse_before_evidence: boolean | null; // null: never wide, never collapsed, or no evidence captured (UNKNOWN)
  collapse_before_invocation: boolean | null;
  final_label: string | null;
}

/** Pure: the width curve from statements and a label per statement (same label = same framing). */
export function width(x: Extract, label: (i: number) => string, tick = 10): Width {
  const times = [...new Set([x.t0, ...x.stmts.map((s) => s.ts), ...x.leaves.map((l) => l.ts), ...x.settled.map((s) => s.ts)])]
    .filter((t) => t >= x.t0 && t <= x.end).sort();
  const at = (t: string) => {
    const held = new Map<string, number>(), ideas = new Map<string, number>();
    for (const s of x.stmts) {
      if (s.ts > t) continue;
      if (s.source === "idea") ideas.set(s.key!, s.i);
      else held.set(s.seat, s.i);
    }
    for (const l of x.leaves) if (l.ts <= t && l.ts >= x.t0) held.delete(l.seat);
    for (const st of x.settled) if (st.ts <= t) { const i = ideas.get(st.key); if (i !== undefined && x.stmts[i].ts <= st.ts) ideas.delete(st.key); }
    const h = new Set([...held.values()].map(label)), b = new Set([...h, ...[...ideas.values()].map(label)]);
    return { held: h.size, board: b.size, labels: h };
  };
  const steps = times.map((t) => ({ t, ...at(t) }));
  const r0 = at(x.t0);
  // a seat leaving at the end empties the room: the last state with anyone holding a framing is the end state
  const live = steps.filter((s) => s.held > 0);
  let toOne: string | null = null;
  for (let k = live.length - 1; k >= 0 && live[k].held <= 1; k--) toOne = live[k].t;
  const wide = live.some((s) => s.held >= 2);
  const collapse = wide && toOne ? toOne : null;
  const cmp = (ev: string | null) => (collapse === null || ev === null ? null : collapse < ev ? true : collapse > ev ? false : null);
  const curve: Width["curve"] = [];
  for (let m = 0; ; m += tick) {
    const t = new Date(Date.parse(x.t0) + m * 60000).toISOString();
    const c = at(t > x.end ? x.end : t);
    curve.push({ min: m, held: c.held, board: c.board });
    if (t >= x.end) break;
  }
  const finalLabels = live.length ? [...live[live.length - 1].labels] : [];
  return {
    room: x.room, itemized: x.itemized, statements: x.stmts.length, seats: new Set(x.stmts.map((s) => s.seat)).size,
    held_at_reveal: r0.held, board_at_reveal: r0.board, max_held: Math.max(0, ...steps.map((s) => s.held)), curve,
    never_wide: r0.held <= 1,
    minutes_to_one: collapse ? minutes(x.t0, collapse) : toOne && !wide ? 0 : null,
    first_evidence_min: x.first_evidence ? minutes(x.t0, x.first_evidence) : null, first_evidence_ref: x.first_evidence_ref,
    first_invocation_min: x.first_invocation ? minutes(x.t0, x.first_invocation) : null,
    collapse_before_evidence: cmp(x.first_evidence), collapse_before_invocation: cmp(x.first_invocation),
    final_label: finalLabels.length === 1 ? finalLabels[0] : null,
  };
}

/** Pure: average-linkage agglomerative clustering on cosine; merge while the closest pair's mean similarity >= cut. */
export function cluster(vecs: number[][], cut: number): number[] {
  const n = vecs.length, norm = vecs.map((v) => Math.hypot(...v) || 1);
  const sim = (a: number, b: number) => vecs[a].reduce((s, x, k) => s + x * vecs[b][k], 0) / (norm[a] * norm[b]);
  const S = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => (a === b ? 1 : sim(a, b))));
  let groups = Array.from({ length: n }, (_, i) => [i]);
  const link = (g: number[], h: number[]) => { let s = 0; for (const a of g) for (const b of h) s += S[a][b]; return s / (g.length * h.length); };
  for (;;) {
    let best = -Infinity, bi = -1, bj = -1;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      const l = link(groups[i], groups[j]);
      if (l > best) { best = l; bi = i; bj = j; }
    }
    if (bi < 0 || best < cut) break;
    groups[bi] = [...groups[bi], ...groups[bj]];
    groups = groups.filter((_, k) => k !== bj);
  }
  const out = new Array<number>(n);
  groups.forEach((g, k) => g.forEach((i) => (out[i] = k)));
  return out;
}

/** Subtract the room's mean vector, so a cosine measures what a statement adds beyond the room's shared topic. */
export const centre = (vecs: number[][]) => {
  const d = vecs[0]?.length ?? 0, mean = new Array<number>(d).fill(0);
  for (const v of vecs) v.forEach((x, k) => (mean[k] += x / vecs.length));
  return vecs.map((v) => v.map((x, k) => x - mean[k]));
};

/** Pairwise agreement of two labellings over the same statements: F1 of "same framing" pairs and the Rand index. */
export function pairAgreement(a: string[], b: string[]) {
  let tp = 0, fp = 0, fn = 0, agree = 0, pairs = 0;
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) {
    const x = a[i] === a[j], y = b[i] === b[j];
    pairs++; if (x === y) agree++;
    if (x && y) tp++; else if (!x && y) fp++; else if (x && !y) fn++;
  }
  return { pairs, f1: tp + fp + fn ? (2 * tp) / (2 * tp + fp + fn) : 1, rand: pairs ? agree / pairs : 1 };
}

const EMBED_CHARS = 1200;
export const embedText = (s: Stmt) => `${s.key && s.source === "board" || s.source === "idea" ? `${s.key}\n` : ""}${s.text}`.slice(0, EMBED_CHARS);

function read(file: string): Ev[] {
  return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

function dump(x: Extract, stage: string, events: Ev[], messages: boolean) {
  const seatName = new Map<string, string>();
  for (const e of events) if (e.type === "join" && e.p) seatName.set(String(e.p.id), String(e.p.name));
  const who = (s: string) => seatName.get(s) ?? s;
  const stop = stage === "reveal" ? x.t0 : stage === "chrono" ? null : undefined;
  console.log(`# ${x.room}  t0=${x.t0}  end=${minutes(x.t0, x.end)} min  itemized=${x.itemized}  statements=${x.stmts.length}`);
  const topic = String(events.find((e) => e.type === "room")?.opts?.topic ?? "");
  console.log(`# topic: ${topic.slice(0, 1500).replace(/\s+/g, " ")}`);
  const rows: { ts: string; line: string }[] = [];
  for (const s of x.stmts) {
    if (stop && s.ts > stop) continue;
    // chrono withholds the conclusion: the concluded proposal's versions and the votes on it
    if (stage === "chrono" && (s.source === "proposal" || s.source === "amend" || s.source === "vote") && s.key === x.conclusion_proposal) continue;
    const body = s.source === "vote" ? `agrees with #${s.adopts}` : s.text.slice(0, stage === "reveal" ? 1200 : 700).replace(/\s+/g, " ");
    rows.push({ ts: s.ts, line: `#${s.i} [${minutes(x.t0, s.ts)}m] ${who(s.seat)} ${s.source}${s.key && s.source !== "vote" ? ` ${s.key}` : ""}: ${body}` });
  }
  if (stage !== "reveal") {
    for (const l of x.leaves) if (l.ts >= x.t0) rows.push({ ts: l.ts, line: `   [${minutes(x.t0, l.ts)}m] ${who(l.seat)} LEFT` });
    for (const st of x.settled) rows.push({ ts: st.ts, line: `   [${minutes(x.t0, st.ts)}m] ${st.key} settled/cleared` });
    if (x.first_evidence) rows.push({ ts: x.first_evidence, line: `   [${minutes(x.t0, x.first_evidence)}m] FIRST CHECKABLE EVIDENCE (board/check proxy): ${x.first_evidence_ref}` });
    if (x.first_invocation) rows.push({ ts: x.first_invocation, line: `   [${minutes(x.t0, x.first_invocation)}m] first run|web invocation (sensitivity)` });
  }
  if (messages && stage !== "reveal") for (const e of events) if (e.type === "message" && e.msg?.kind !== "system" && e.msg?.ts >= x.t0 && e.msg?.ts <= x.end)
    rows.push({ ts: e.msg.ts, line: `   [${minutes(x.t0, e.msg.ts)}m] msg ${e.msg.from?.name}: ${String(e.msg.content ?? "").slice(0, 300).replace(/\s+/g, " ")}` });
  rows.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)).forEach((r) => console.log(r.line));
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const files = args.filter((a, i) => !a.startsWith("--") && !["--stage", "--labels", "--cut"].includes(args[i - 1]))
    .flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith(".jsonl")).map((f) => join(p, f)) : [p]));
  if (!files.length) { console.error("usage: framing-width [--dump <room.jsonl> [--stage reveal|chrono|all] [--messages]] | <room.jsonl | dir> [...] [--labels f.json] [--cut c] [--centre] [--json]"); process.exit(2); }
  if (args.includes("--dump")) {
    for (const f of files) { const ev = read(f); dump(extract(ev, basename(f, ".jsonl")), opt("--stage") ?? "all", ev, args.includes("--messages")); }
    return;
  }
  // --labels: {room: {statementIndex: label}}; statements without a label get their own singleton label
  const labels = opt("--labels") ? (JSON.parse(readFileSync(opt("--labels")!, "utf8")) as Record<string, Record<string, string>>) : null;
  const cut = Number(opt("--cut") ?? "NaN");
  const rows: Width[] = [];
  for (const f of files) {
    const ev = read(f);
    if (!ev.some((e) => e.type === "room")) continue;
    const x = extract(ev, basename(f, ".jsonl"));
    if (!x.stmts.length) continue;
    let lab: (i: number) => string;
    if (labels) {
      const l = labels[x.room]; if (!l) continue;
      lab = (i) => l[String(i)] ?? `#${i}`;
    } else {
      if (!Number.isFinite(cut)) { console.error("--cut is required without --labels"); process.exit(2); }
      const { embedTexts } = await import("./embed-cache.ts");
      let vecs = await embedTexts(x.stmts.map(embedText));
      if (args.includes("--centre")) vecs = centre(vecs);
      const c = cluster(vecs, cut);
      lab = (i) => { const s = x.stmts[i]; return s.adopts !== undefined ? `c${c[s.adopts]}` : `c${c[i]}`; };
    }
    rows.push(width(x, lab));
  }
  if (args.includes("--json")) { console.log(JSON.stringify(rows, null, 1)); return; }
  for (const r of rows) console.log(`${r.room}: itemized=${r.itemized} held@reveal=${r.held_at_reveal} board@reveal=${r.board_at_reveal} max=${r.max_held} to_one=${r.minutes_to_one ?? "-"} ev=${r.first_evidence_min ?? "-"} inv=${r.first_invocation_min ?? "-"} before_ev=${r.collapse_before_evidence ?? "UNKNOWN"} curve=${r.curve.map((c) => c.held).join(",")}`);
}

if (process.argv[1] && /^framing-width\.[cm]?[jt]s$/.test(basename(process.argv[1]))) main().catch((e) => { console.error(e); process.exit(1); });
