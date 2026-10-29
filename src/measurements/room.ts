/**
 * RSI-7's four measurements for one room, from its log, so every run prints them with no hand command
 * (item/report-wiring, decision/report-wiring): opening spread, held width at the reveal, winner provenance, steer split.
 * Each block is {status, value, coverage, unknown, source, validity}; nothing here throws. A missing embedder, labeller or
 * conclusion is an `unknown` reason beside the block, and an error is that block's own string, so one bad block never
 * costs a run its result.json (gh:UKGovernmentBEIS/inspect_ai keeps unscored counts beside a score, never a fake zero).
 * The numbers are the standalone scripts' own (scripts/measurements-parity.ts checks that); their validity is RSI-7's,
 * carried over unchanged and named in each block's `validity` line.
 */
import { embedTexts } from "./embed.js";
import { extract, width } from "./framing-width.js";
import { openingsOf, spreadOf } from "./opening-spread.js";
import { collectSteers, counts } from "./steer-split.js";
import { provenance } from "./winner-provenance.js";

type Ev = Record<string, any>;
export type Embed = (texts: string[]) => Promise<number[][]>;
export interface Embedder { model: string; embed: Embed }
export interface Block<T> {
  status: "ok" | "unknown" | "error";
  value: T | null;
  coverage: Record<string, number>;
  unknown: string[];
  /** The script and options the same numbers come from by hand. */
  source: string;
  /** What RSI-7 found the number is worth; printed beside it. */
  validity: string;
  error?: string;
}
/** labels/width-hand.json: {room: {statementIndex | "*": label}}. */
export type WidthLabels = Record<string, Record<string, string>>;
/** docs/measurements/winner-provenance-*-labels.json rows: the adjudicated origin when there is one. */
export type ProvenanceLabels = { room: string; origin: string; adjudicated_origin?: string }[];
export interface MeasureOptions { embedder?: Embedder | null; embedderError?: string; widthLabels?: WidthLabels; provenanceLabels?: ProvenanceLabels; budgetMs?: number }

/** One bound on a room's whole embedding work (spread and provenance embed at once under it), so the launcher's fetch
 * (collect.ts COLLECT_TIMEOUT_MS) always outlasts it and gets the label-free blocks back (attack/decision/report-wiring). */
export const MEASURE_BUDGET_MS = 60_000;

/** RSI-7's fitted opening cut (result/opening-spread: majority labels, AUROC 0.75, n=17). Cosines are the model's own. */
export const SPREAD_CUTS: Record<string, number> = { embeddinggemma: 0.599 };

/** CHATROOM_EMBED_URL names the endpoint; unset means "embedder absent", never a localhost guess (the scripts keep theirs). */
export function embedderFromEnv(env: NodeJS.ProcessEnv = process.env): Embedder | null {
  const url = env.CHATROOM_EMBED_URL?.trim();
  if (!url) return null;
  const model = env.CHATROOM_EMBED_MODEL?.trim() || "embeddinggemma";
  return { model, embed: (texts) => embedTexts(texts, { model, url, timeoutMs: Number(env.CHATROOM_EMBED_TIMEOUT_MS) || 60_000 }) };
}

const ms = (e: unknown) => (e instanceof Error ? e.message : String(e));
const absent = (o: MeasureOptions) => (o.embedderError ? `embedder error: ${o.embedderError}` : "embedder absent (CHATROOM_EMBED_URL unset)");

async function openingSpread(events: Ev[], room: string, o: MeasureOptions): Promise<Block<Record<string, any>>> {
  const source = "scripts/opening-spread.ts --json --cut 0.599 --min-seats 2";
  const validity = "descriptive: cosine is not a width measure (proposed rooms-open-on-one-framing); same-provider pairs sit +0.106 closer";
  const r = openingsOf(events, room);
  const coverage = { worker_openings: r.openings.length, embedded: 0 };
  const b: Block<Record<string, any>> = { status: "unknown", value: null, coverage, unknown: [], source, validity };
  if (!events.some((e) => e.type === "openings_revealed")) b.unknown.push("no reveal: the room sealed no openings");
  else if (r.openings.length < 2) b.unknown.push(`${r.openings.length} worker opening(s): a spread needs 2`);
  if (!o.embedder) b.unknown.push(absent(o));
  if (b.unknown.length) return b;
  try {
    const vecs = await o.embedder!.embed(r.openings.map((x) => x.text));
    const model = o.embedder!.model.split(":")[0]!, cut = SPREAD_CUTS[model];
    coverage.embedded = vecs.length;
    if (cut === undefined) b.unknown.push(`no fitted cut for ${o.embedder!.model}: no framing count`);
    return { ...b, status: "ok" as const, value: { ...spreadOf(r, vecs, cut), cut: cut ?? null } };
  } catch (e) { return { ...b, status: "error" as const, error: ms(e) }; }
}

function framingWidth(events: Ev[], room: string, o: MeasureOptions): Block<Record<string, any>> {
  const labels = o.widthLabels?.[room];
  const source = `scripts/framing-width.ts --json${labels ? " --labels <width labels>" : " (statements and times only)"}`;
  const validity = labels ? "hand labels (one labeller, RSI-7 n=20)"
    : "held width needs a validated labeller: RSI-7's LOO-fitted embedding clustering equals a constant one-framing labeller (19/20 each) and unfitted cuts call 9-20/20 rooms wide against a hand 1/20 (proposed no-collapse-before-evidence)";
  try {
    const x = extract(events, room);
    const coverage = { statements: x.stmts.length, labelled: 0 };
    const timing = { statements: x.stmts.length, seats: new Set(x.stmts.map((s) => s.seat)).size, ...firstTimes(x) };
    if (!x.stmts.length) return { status: "unknown" as const, value: null, coverage, unknown: ["no framing statements"], source, validity };
    if (!labels) return { status: "unknown" as const, value: { labeller: null, held_at_reveal: null, ...timing }, coverage, unknown: ["no validated labeller"], source, validity };
    // a vote holds what its proposal holds; "*" labels every statement not listed
    const lab = (i: number) => { const s = x.stmts[i]!; return labels[String(s.adopts ?? i)] ?? labels["*"]; };
    coverage.labelled = x.stmts.filter((_, i) => lab(i) !== undefined).length;
    // the script names an unlabelled statement its own framing ("#k"), which counts width nobody labelled: partial labels give none
    if (coverage.labelled < x.stmts.length) return { status: "unknown" as const, value: { labeller: null, held_at_reveal: null, ...timing }, coverage, unknown: [`hand labels cover ${coverage.labelled}/${x.stmts.length} statements: a held width needs every one ("*" labels the rest)`], source, validity };
    const w = width(x, (i) => lab(i)!);
    return { status: "ok" as const, value: { labeller: "hand", ...timing, held_at_reveal: w.held_at_reveal, board_at_reveal: w.board_at_reveal, max_held: w.max_held, minutes_to_one: w.minutes_to_one, collapse_before_evidence: w.collapse_before_evidence }, coverage, unknown: [], source, validity };
  } catch (e) { return { status: "error" as const, value: null, coverage: {}, unknown: [], source, validity, error: ms(e) }; }
}

/** The label-free half of framing-width: when the first checkable evidence and the first run|web call came, from the reveal. */
function firstTimes(x: ReturnType<typeof extract>) {
  const min = (t: string | null) => (t ? Math.round(((Date.parse(t) - Date.parse(x.t0)) / 60000) * 10) / 10 : null);
  return { first_evidence_min: min(x.first_evidence), first_evidence_ref: x.first_evidence_ref, first_invocation_min: min(x.first_invocation), end_min: min(x.end) };
}

async function winnerProvenance(events: Ev[], room: string, o: MeasureOptions): Promise<Block<Record<string, any>>> {
  const hand = o.provenanceLabels?.find((l) => l.room === room);
  const source = "scripts/winner-provenance.ts --json --vectors <embedder> --model <model> (no --cut)";
  const validity = "descriptive alignment, not influence; no cut was fitted, so origin is a hand label or unknown (proposed winner-present-at-reveal: 19/20 present at the reveal, blind audit 14/15)";
  try {
    const bare = provenance(events, room);
    const texts = [...new Set([...bare.openings, ...bare.seeded, ...(bare.final ? [bare.final] : [])].map((d) => d.embedded_text).concat(bare.brief?.embedded_text ?? "").filter(Boolean))];
    const unknown: string[] = [];
    if (!bare.final) unknown.push("not concluded: no winner");
    let vectors: Map<string, number[]> | undefined, error: string | undefined;
    if (bare.final && !o.embedder) unknown.push(absent(o));
    if (bare.final && o.embedder) {
      try { const v = await o.embedder.embed(texts); vectors = new Map(texts.map((t, i) => [t, v[i]!])); }
      catch (e) { error = ms(e); }
    }
    const p = vectors ? provenance(events, room, { vectors }) : bare;
    if (!hand) unknown.push("no hand label: origin unknown");
    const nearest = p.opening_matches[0];
    const receipts = p.revisions.filter((r) => r.exposure_coverage === "receipt_present").length;
    // by channel, never one "trigger known" total: a read of resource/* or item/* is not a peer's framing (review/389e411c).
    // the message channel counts only revisions whose interval has an explicit delivery receipt (receipt_basis, from
    // item/delivery-receipts); a build without the field, or a log with no explicit receipt, gives null, not 0
    const explicit = p.revisions.filter((r) => (r as { receipt_basis?: string }).receipt_basis === "explicit");
    const delivered = explicit.length ? explicit.filter((r) => ((r as { peer_deliveries?: unknown[] }).peer_deliveries ?? []).length > 0).length : null;
    const board = boardChannel(p.revisions);
    const value = {
      concluded: p.concluded, label: hand ? (hand.adjudicated_origin ?? hand.origin) : null, label_source: hand ? (hand.adjudicated_origin ? "hand (adjudicated)" : "hand (primary)") : null,
      origin: p.origin, nearest_opening: nearest && nearest.similarity !== null ? { author: nearest.author, similarity: round(nearest.similarity) } : null,
      brief_similarity: p.brief_similarity === null ? null : round(p.brief_similarity),
      closer_to_brief: p.brief_similarity !== null && nearest?.similarity != null ? p.brief_similarity > nearest.similarity : null,
      named_ideas: p.named_ideas, candidate_revisions: p.revisions.length, revisions_with_receipt: receipts, revisions_with_explicit_receipt: explicit.length, revisions_after_peer_delivery: delivered, revisions_after_peer_framing_read: board.count, board_channel: board.source,
    };
    return { status: (error ? "error" : p.final && (vectors || hand) ? "ok" : "unknown") as Block<unknown>["status"], value, coverage: { openings: p.openings.length, seeded: p.seeded.length, vectors: p.vector_coverage.available, requested: p.vector_coverage.requested }, unknown, source, validity, ...(error ? { error } : {}) };
  } catch (e) { return { status: "error" as const, value: null, coverage: {}, unknown: [], source, validity, error: ms(e) }; }
}
const round = (x: number) => Math.round(x * 1000) / 1000;
/** The board keys winner-provenance counts as a peer's framing when a seat reads one (its revisionContext "peer" rule). */
const PEER_FRAMING = /^(draft|position|decision|design|hypothesis|plan)\//;
/** Revisions after a peer content-board read. item/delivery-receipts' trigger_board_reads (peer-authored framing and evidence
 * keys only, so launcher and system entries never count) when the build has it; else peer_board_reads on PEER_FRAMING. */
export function boardChannel(revisions: readonly { peer_board_reads: { key: string }[]; trigger_board_reads?: unknown[] }[]) {
  if (revisions.some((r) => Array.isArray(r.trigger_board_reads))) return { source: "trigger_board_reads" as const, count: revisions.filter((r) => (r.trigger_board_reads ?? []).length > 0).length };
  return { source: "peer_board_reads" as const, count: revisions.filter((r) => r.peer_board_reads.some((b) => PEER_FRAMING.test(b.key))).length };
}

function steerSplit(events: Ev[], room: string): Block<Record<string, any>> {
  const source = "scripts/steer-split.ts --json";
  const validity = "lexical proxy, not a rate: a 30-steer sample's blind audit agreed 6/10 (proposed steer-split-unreliable)";
  try {
    const rows = collectSteers([{ file: room, events }]);
    const value = { steers: rows.length, human: rows.filter((r) => r.role === "human").length, chair: rows.filter((r) => r.role === "chair").length, notes: rows.filter((r) => r.kind === "note").length, corrections: rows.filter((r) => r.kind === "correction").length, proxy: counts(rows.map((r) => r.proxy)) };
    return { status: "ok" as const, value, coverage: { logs: 1 }, unknown: [], source, validity };
  } catch (e) { return { status: "error" as const, value: null, coverage: {}, unknown: [], source, validity, error: ms(e) }; }
}

export interface RoomMeasurements {
  schema: "room-measurements-v1"; room: string; computed_ms: number;
  embedder: { status: "present" | "absent" | "error"; model: string | null; error?: string };
  opening_spread: Block<Record<string, any>>; framing_width: Block<Record<string, any>>; winner_provenance: Block<Record<string, any>>; steer_split: Block<Record<string, any>>;
}

/** The embedder raced against one deadline shared by every call: past it each pending call fails with the budget named. */
function bounded(e: Embedder, budgetMs: number): { embedder: Embedder; done: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`embedder exceeded the ${budgetMs} ms measurement budget`)), budgetMs); });
  late.catch(() => {});
  return { embedder: { model: e.model, embed: (texts) => Promise.race([e.embed(texts), late]) }, done: () => clearTimeout(timer) };
}

export async function measureRoom(events: Ev[], room = String(events.find((e) => e.type === "room")?.room ?? events[0]?.room ?? ""), o: MeasureOptions = {}): Promise<RoomMeasurements> {
  const t0 = Date.now();
  const framing_width = framingWidth(events, room, o), steer_split = steerSplit(events, room);
  const bound = o.embedder ? bounded(o.embedder, o.budgetMs ?? MEASURE_BUDGET_MS) : null;
  const oe = bound ? { ...o, embedder: bound.embedder } : o;
  const [opening_spread, winner_provenance] = await Promise.all([openingSpread(events, room, oe), winnerProvenance(events, room, oe)]).finally(() => bound?.done());
  const embedError = [opening_spread, winner_provenance].find((b) => b.status === "error")?.error;
  const embedder: RoomMeasurements["embedder"] = o.embedder ? { status: embedError ? "error" : "present", model: o.embedder.model, ...(embedError ? { error: embedError } : {}) }
    : { status: o.embedderError ? "error" : "absent", model: null, ...(o.embedderError ? { error: o.embedderError } : {}) };
  return { schema: "room-measurements-v1", room, computed_ms: Date.now() - t0, embedder, opening_spread, framing_width, winner_provenance, steer_split };
}

const f = (x: unknown) => (x === null || x === undefined ? "?" : String(x));
const why = (b: Block<unknown>) => [...(b.error ? [`error: ${b.error}`] : []), ...b.unknown].join("; ");

/** One section per room for report.md and run-metrics. Every unknown says why; nothing reads as a zero. */
export function renderMeasurements(rooms: readonly RoomMeasurements[], errors: readonly string[] = []): string {
  if (!rooms.length && !errors.length) return "";
  let t = "## Measurements\n\nRSI-7's four room measurements, computed from the room log at the end of the run. Each line says what it is worth.\n\n";
  for (const m of rooms) {
    const e = m.embedder;
    t += `### ${m.room}\n\nEmbedder: ${e.status === "present" ? e.model : e.status === "error" ? `error (${e.error})` : "absent (CHATROOM_EMBED_URL unset)"}; computed in ${m.computed_ms} ms.\n\n`;
    const s = m.opening_spread, sv = s.value;
    t += `- **Opening spread**: ${sv ? `${sv.seats} worker openings (${sv.mix}), mean cosine ${sv.mean_cos}, min ${sv.min_cos}, effective rank ${sv.eff_rank}/${sv.seats}, ${sv.framings === null ? "no framing count" : `${sv.framings} framing(s) at cut ${sv.cut}${sv.one_framing ? " (one framing)" : ""}`}${sv.same_provider_cos !== null && sv.cross_provider_cos !== null ? `; same-provider ${sv.same_provider_cos} vs cross-provider ${sv.cross_provider_cos}` : ""}` : `unknown (${why(s)})`}. Coverage ${s.coverage.embedded ?? 0}/${s.coverage.worker_openings ?? 0} embedded. _${s.validity}._\n`;
    const w = m.framing_width, wv = w.value;
    const times = wv ? `${wv.statements} framing statements by ${wv.seats} seat(s); first checkable evidence ${wv.first_evidence_min === null ? "none logged" : `at ${wv.first_evidence_min} min (${wv.first_evidence_ref})`}; first run/web call ${wv.first_invocation_min === null ? "none logged" : `at ${wv.first_invocation_min} min`}; end at ${f(wv.end_min)} min, from the reveal` : "";
    t += `- **Held width at the reveal**: ${wv?.labeller ? `${wv.held_at_reveal} (hand labels; ${w.coverage.labelled}/${w.coverage.statements} statements labelled), max ${wv.max_held}, to one framing at ${f(wv.minutes_to_one)} min, collapse before evidence ${f(wv.collapse_before_evidence)}. ${times}` : `unknown (${why(w)})${times ? `. ${times}` : ""}`}. _${w.validity}._\n`;
    const p = m.winner_provenance, pv = p.value;
    t += `- **Winner provenance**: ${pv && !pv.concluded ? `no winner (not concluded); ${pv.candidate_revisions} candidate revision(s) so far` : pv ? `${pv.label ? `${pv.label === "opening" ? "present at the reveal" : pv.label === "midroom" ? "mid-room" : pv.label} (${pv.label_source})` : "origin unknown"}; nearest opening ${pv.nearest_opening ? `cosine ${pv.nearest_opening.similarity} (${pv.nearest_opening.author})` : "?"}; conclusion-to-brief cosine ${f(pv.brief_similarity)}${pv.closer_to_brief === null ? "" : pv.closer_to_brief ? " (closer to the brief)" : " (closer to an opening)"}; ${pv.candidate_revisions} candidate revision(s), ${pv.revisions_with_receipt} with an attention receipt${pv.revisions_after_peer_delivery === null || pv.revisions_after_peer_delivery === undefined ? "" : `, ${pv.revisions_after_peer_delivery} of ${pv.revisions_with_explicit_receipt} with an explicit delivery receipt after a delivered peer message`}, ${pv.revisions_after_peer_framing_read ?? 0} after reading a peer's ${pv.board_channel === "trigger_board_reads" ? "framing or evidence" : "draft/decision"} entry (order only, causality unproven); idea keys named in the conclusion: ${pv.named_ideas.length ? pv.named_ideas.join(", ") : "none"}${why(p) ? ` (${why(p)})` : ""}` : `unknown (${why(p)})`}. _${p.validity}._\n`;
    const st = m.steer_split, sp = st.value;
    t += `- **Steer split**: ${sp ? `${sp.steers} steer(s): ${sp.human} human, ${sp.chair} chair, ${sp.notes} inbox note(s), ${sp.corrections} correction(s); lexical cues reframe ${sp.proxy.reframe}, unblock ${sp.proxy.unblock}, both ${sp.proxy.both}, other ${sp.proxy.other}, uncertain ${sp.proxy.uncertain}` : `unknown (${why(st)})`}. _${st.validity}._\n\n`;
  }
  if (errors.length) t += `Measurement collection errors:\n${errors.map((e) => `- ${e}`).join("\n")}\n\n`;
  return t;
}

/** --width-labels and --provenance-labels for the scripts that measure past rooms (run-metrics, runs-table, parity). */
export function readLabelOptions(argv: readonly string[], read: (path: string) => string): Pick<MeasureOptions, "widthLabels" | "provenanceLabels"> {
  const opt = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const w = opt("--width-labels"), p = opt("--provenance-labels");
  const rows = p ? JSON.parse(read(p)) : undefined;
  return { ...(w ? { widthLabels: JSON.parse(read(w)) as WidthLabels } : {}), ...(rows ? { provenanceLabels: (Array.isArray(rows) ? rows : rows.rows) as ProvenanceLabels } : {}) };
}
export const LABEL_FLAGS = ["--width-labels", "--provenance-labels"];

/** One row per room for runs-table, then how many rooms each measurement covered: a block is only as useful as its coverage. */
export function renderMeasurementsTable(rows: readonly RoomMeasurements[]): string {
  if (!rows.length) return "";
  const cell = (b: Block<Record<string, any>>, ok: (v: Record<string, any>) => string) => (b.value && b.status !== "error" ? ok(b.value) : b.status === "error" ? "error" : (b.unknown[0] ?? "?").replace(/ \(.*$/, ""));
  let t = "| room | embedder | spread: openings / mean cos / framings | held width at reveal | provenance: label / nearest opening / brief | steers: human / chair / notes |\n|---|---|---|---|---|---|\n";
  for (const m of rows) {
    t += `| ${m.room} | ${m.embedder.status} | ${cell(m.opening_spread, (v) => `${v.seats} / ${v.mean_cos} / ${v.framings ?? "?"}`)} | ${m.framing_width.value?.labeller ? `${m.framing_width.value.held_at_reveal} (hand)` : "unknown"} | ${cell(m.winner_provenance, (v) => `${v.label ?? "?"} / ${v.nearest_opening?.similarity ?? "?"} / ${v.brief_similarity ?? "?"}`)} | ${cell(m.steer_split, (v) => `${v.human} / ${v.chair} / ${v.notes}`)} |\n`;
  }
  const n = rows.length, ok = (k: "opening_spread" | "framing_width" | "winner_provenance" | "steer_split") => rows.filter((m) => m[k].status === "ok").length;
  return t + `\nMeasured: spread ${ok("opening_spread")}/${n}, held width ${ok("framing_width")}/${n} (hand labels only), provenance ${ok("winner_provenance")}/${n}, steers ${ok("steer_split")}/${n}; embedder ${rows.filter((m) => m.embedder.status === "present").length}/${n}.\n`;
}
