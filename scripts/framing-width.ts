/**
 * How many distinct framings a room holds over time, when it falls to one, and whether that came before its first evidence
 * (item/width-and-collapse; the rule was registered as decision/width-rule before any number was computed).
 * A framing statement is a seat's opening, its own board entry under any key that is not a work area, evidence or admin
 * (NOT_FRAMING; --keys allow keeps the v2 draft/position/decision/design/hypothesis/plan list), an idea, a proposal or
 * amend text it wrote, or an agree vote (the voter now holds the proposal's current text). claim/take/evidence/result are
 * work areas and evidence, not framings: seat targets hand out items at launch, so a claim is not a hypothesis.
 * HELD width at time t = distinct framing labels among each present seat's latest statement; BOARD width adds idea/* entries
 * not cleared or settled. Labels come from hand labels (--labels) or from average-linkage clustering of embeddings at a cut.
 * minutes_to_one is the exact time after which held width stays <= 1 to the end; collapse_before_evidence compares it with
 * the first checkable evidence (result/evidence/findings/verify entry, check or review event: decision/door's primary proxy;
 * a chat passage with an observation also counts there and this script cannot see it, so its D2 is an upper bound) and,
 * as a sensitivity, the first run|web invocation in the work ledger.
 *   npx tsx scripts/framing-width.ts --dump <room.jsonl> [--stage reveal|chrono|all] [--messages]   statements, no clusters
 *   npx tsx scripts/framing-width.ts <room.jsonl | data dir> [...] [--labels labels.json] [--cut 0.x] [--centre] [--all-seats] [--keys allow|deny] [--json]
 * The pure core is src/measurements/framing-width.ts (the run report calls it too); this file is the CLI.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { centre, cluster, embedText, type Extract, extract, minutes, pairAgreement, width, type Width } from "../src/measurements/framing-width.js";

export * from "../src/measurements/framing-width.js";

type Ev = Record<string, any>;

function read(file: string): Ev[] {
  return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

/** Share of a's and b's lines that the other does not have, as a rough size of an amend. */
const changed = (a: string, b: string) => {
  const la = a.split("\n").map((l) => l.trim()).filter(Boolean), lb = b.split("\n").map((l) => l.trim()).filter(Boolean);
  const sa = new Set(la), sb = new Set(lb);
  const diff = la.filter((l) => !sb.has(l)).length + lb.filter((l) => !sa.has(l)).length;
  return Math.round((100 * diff) / Math.max(1, la.length + lb.length));
};

function dump(x: Extract, stage: string, events: Ev[], messages: boolean, compact = false) {
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
    // --compact: votes adopt their proposal's framing and an amend mostly rewords it, so show how much each amend changed
    if (compact && s.source === "vote") continue;
    const prev = s.source === "amend" || s.source === "board" || s.source === "idea" ? [...x.stmts.slice(0, s.i)].reverse().find((p) => p.key === s.key && p.source !== "vote") : undefined;
    const body = s.source === "vote" ? `agrees with #${s.adopts}`
      : prev && compact ? `changed ${changed(prev.text, s.text)}% of lines vs #${prev.i} (${s.text.length} chars)`
      : s.text.slice(0, stage === "reveal" ? 1200 : compact ? 450 : 700).replace(/\s+/g, " ");
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

const CUTS = Array.from({ length: 19 }, (_, k) => Math.round((0.05 * k + 0.05) * 100) / 100); // 0.05 .. 0.95

/** --fit: the registered leave-one-room-out check. For each room, pick variant (raw|centred) and cut on the OTHER rooms by
 * mean pair F1 against the hand labels (ties -> raw, then the lower cut), score the left-out room with them, and report
 * pair F1, Rand and whether held width at the reveal (>= 2 or not) and collapse-before-evidence match the labels. A
 * constant "one framing" labeller is printed beside it: with few wide rooms, agreement alone does not show the clustering
 * can see width. */
async function fit(files: string[], labels: Record<string, Record<string, string>>, allSeats: boolean, json: boolean, keys: "allow" | "deny") {
  const { embedTexts } = await import("./embed-cache.ts");
  type R = { x: Extract; hand: (i: number) => string; idx: number[]; vecs: Record<string, number[][]> };
  const rooms: R[] = [];
  for (const f of files) {
    const x = extract(read(f), basename(f, ".jsonl"), { allSeats, keys });
    const l = labels[x.room]; if (!l || !x.stmts.length) continue;
    const hand = (i: number) => { const s = x.stmts[i], k = String(s.adopts ?? i); return l[k] ?? l["*"] ?? `#${k}`; };
    const idx = x.stmts.filter((s) => s.source !== "vote").map((s) => s.i);
    const raw = await embedTexts(idx.map((i) => embedText(x.stmts[i])));
    rooms.push({ x, hand, idx, vecs: { raw, centred: centre(raw) } });
  }
  const labelsAt = (r: R, variant: string, cut: number) => {
    const c = cluster(r.vecs[variant], cut), at = new Map(r.idx.map((i, k) => [i, `c${c[k]}`]));
    return (i: number) => at.get(r.x.stmts[i].adopts ?? i)!;
  };
  const score = (r: R, variant: string, cut: number) => pairAgreement(r.idx.map(r.hand), r.idx.map(labelsAt(r, variant, cut))).f1;
  const out = rooms.map((r) => {
    let best = { variant: "raw", cut: CUTS[0], f1: -1 };
    for (const variant of ["raw", "centred"]) for (const cut of CUTS) {
      const others = rooms.filter((o) => o !== r), f1 = others.reduce((s, o) => s + score(o, variant, cut), 0) / Math.max(1, others.length);
      if (f1 > best.f1 + 1e-9) best = { variant, cut, f1 };
    }
    const script = width(r.x, labelsAt(r, best.variant, best.cut)), hand = width(r.x, r.hand), one = width(r.x, () => "A");
    const pa = pairAgreement(r.idx.map(r.hand), r.idx.map(labelsAt(r, best.variant, best.cut)));
    return {
      room: r.x.room, variant: best.variant, cut: best.cut, pair_f1: Math.round(pa.f1 * 1000) / 1000, rand: Math.round(pa.rand * 1000) / 1000,
      hand_wide_at_reveal: hand.held_at_reveal >= 2, script_wide_at_reveal: script.held_at_reveal >= 2, script_held_at_reveal: script.held_at_reveal,
      hand_collapse_before_evidence: hand.collapse_before_evidence, script_collapse_before_evidence: script.collapse_before_evidence,
      hand_minutes_to_one: hand.minutes_to_one, script_minutes_to_one: script.minutes_to_one, constant_wide_at_reveal: one.held_at_reveal >= 2,
    };
  });
  if (json) { console.log(JSON.stringify(out, null, 1)); return; }
  const n = out.length, agree = (k: (o: (typeof out)[number]) => boolean) => out.filter(k).length;
  for (const o of out) console.log(`${o.room}: LOO ${o.variant}@${o.cut} pairF1=${o.pair_f1} rand=${o.rand} wide@reveal hand=${o.hand_wide_at_reveal} script=${o.script_wide_at_reveal}(${o.script_held_at_reveal}) to_one hand=${o.hand_minutes_to_one ?? "-"} script=${o.script_minutes_to_one ?? "-"} before_ev hand=${o.hand_collapse_before_evidence ?? "UNKNOWN"} script=${o.script_collapse_before_evidence ?? "UNKNOWN"}`);
  console.log(`n=${n} rooms. wide@reveal agreement: script ${agree((o) => o.hand_wide_at_reveal === o.script_wide_at_reveal)}/${n}, constant one-framing ${agree((o) => o.hand_wide_at_reveal === o.constant_wide_at_reveal)}/${n}; ` +
    `collapse_before_evidence agreement: ${agree((o) => o.hand_collapse_before_evidence === o.script_collapse_before_evidence)}/${n}; hand wide@reveal ${agree((o) => o.hand_wide_at_reveal)}/${n}, script ${agree((o) => o.script_wide_at_reveal)}/${n}`);
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  // --rooms <file>: whitespace-separated room names (labels/cohort.txt), read from the data dir given as the path
  const rooms = opt("--rooms") ? new Set(readFileSync(opt("--rooms")!, "utf8").split(/\s+/).filter(Boolean)) : null;
  const files = args.filter((a, i) => !a.startsWith("--") && !["--stage", "--labels", "--cut", "--keys", "--rooms"].includes(args[i - 1]))
    .flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith(".jsonl")).map((f) => join(p, f)) : [p]))
    .filter((f) => !rooms || rooms.has(basename(f, ".jsonl")));
  if (!files.length) { console.error("usage: framing-width [--dump <room.jsonl> [--stage reveal|chrono|all] [--messages]] | <room.jsonl | dir> [...] [--rooms names.txt] [--labels f.json] [--fit] [--cut c] [--centre] [--all-seats] [--keys allow|deny] [--json]"); process.exit(2); }
  if (args.includes("--dump")) {
    for (const f of files) { const ev = read(f); dump(extract(ev, basename(f, ".jsonl"), { allSeats: args.includes("--all-seats"), keys: opt("--keys") === "allow" ? "allow" : "deny" }), opt("--stage") ?? "all", ev, args.includes("--messages"), args.includes("--compact")); }
    return;
  }
  // --labels: {room: {statementIndex: label}}; statements without a label get their own singleton label
  const labels = opt("--labels") ? (JSON.parse(readFileSync(opt("--labels")!, "utf8")) as Record<string, Record<string, string>>) : null;
  if (labels && args.includes("--fit")) { await fit(files, labels, args.includes("--all-seats"), args.includes("--json"), opt("--keys") === "allow" ? "allow" : "deny"); return; }
  const cut = Number(opt("--cut") ?? "NaN");
  const rows: Width[] = [];
  for (const f of files) {
    const ev = read(f);
    if (!ev.some((e) => e.type === "room")) continue;
    const x = extract(ev, basename(f, ".jsonl"), { allSeats: args.includes("--all-seats"), keys: opt("--keys") === "allow" ? "allow" : "deny" });
    if (!x.stmts.length) continue;
    let lab: (i: number) => string;
    if (labels) {
      const l = labels[x.room]; if (!l) continue;
      // a vote holds what its proposal holds; "*" is the label of every statement not listed
      lab = (i) => { const s = x.stmts[i], k = String(s.adopts ?? i); return l[k] ?? l["*"] ?? `#${k}`; };
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
