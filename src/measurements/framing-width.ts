/**
 * How many distinct framings a room holds over time, when it falls to one, and whether that came before its first evidence
 * (moved unchanged from scripts/framing-width.ts so the run report can call it; the CLI and the width rule's notes stay there).
 */
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

// v2 allow-list, kept for --keys allow; v3 (default) reads every worker key that is not a work area, evidence or room
// administration, because framings also sit on ad-hoc keys ("fable-1-dissent", a bare "position", candidates/*, insight/*):
// attack/result/width-and-collapse by claude-opus-5-5-1.
const POSITION = /^(draft|position|decision|design|hypothesis|plan)\//;
const NOT_FRAMING = /^(claim|take|evidence|result|findings|review|verify|verification|resource|inbox|handoff|sources|needs|item|wip|ledger|attack|friction|answered|digest|audit|pilot|integration|bench|benchlock|verifier|spec|inputs|contract|brief|filedigest|decode|ruling|chair|labels|probe|hold|wake|rerun|indep|valid|done|assign|approve|method|fact|live|status|guard|harness|tasks|exp|prereg|research|profile|decision-record|idea|benchqueue|benchjob|benchlock-text|owner-question|final|repro|intake|finding|rank1-shape)(\/|$)/;
export const framingKey = (key: string, keys: "allow" | "deny" = "deny") => (keys === "allow" ? POSITION.test(key) : !NOT_FRAMING.test(key));
const EVIDENCE = /^(result|evidence|findings|verify)\//;
const SETTLED = /^\s*(dropped|done|tested|rejected|refuted)\s*:/i;
const tsOf = (e: Ev): string | undefined => e.ts ?? e.msg?.ts ?? e.entry?.updatedAt ?? e.updatedAt ?? e.proposal?.createdAt ?? e.entry?.ts ?? e.p?.joinedAt;
export const minutes = (a: string, b: string) => Math.round(((Date.parse(b) - Date.parse(a)) / 60000) * 10) / 10;

/** Pure: the framing statements of one room, in log order, with the times the width rule needs. */
export function extract(events: Ev[], room = String(events[0]?.room ?? ""), o: { allSeats?: boolean; keys?: "allow" | "deny" } = {}): Extract {
  const nameToSeat = new Map<string, string>(), excluded = new Set<string>(["launcher", "system", "hub"]);
  // workers only by default: a verifier's opening states how it will check, not an answer (attack/decision/width-rule);
  // --all-seats keeps the verifier as a sensitivity. Chairs and humans are never seats here. Older logs set no role:
  // the verifier is the seat named "verifier" and the chair the room's named chair (opts.chair).
  const chair = String(events.find((e) => e.type === "room")?.opts?.chair ?? "");
  for (const e of events) if (e.type === "join" && e.p) {
    nameToSeat.set(String(e.p.name), String(e.p.id));
    const role = e.p.role ?? (e.p.name === "verifier" ? "verifier" : chair && e.p.name === chair ? "chair" : "worker");
    if (role === "chair" || e.p.agent === "human" || (role === "verifier" && !o.allSeats)) { excluded.add(String(e.p.id)); excluded.add(String(e.p.name)); }
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
      } else if (framingKey(key, o.keys) && text.trim()) push({ ts: when, seat, source: "board", key, text });
    }
    // a proposal is logged again later with its final text and its creation time: the first event is the one stated then
    if (e.type === "proposal" && e.proposal && !proposalStmt.has(String(e.proposal.id))) {
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
