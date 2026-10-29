/**
 * Descriptive conclusion alignment and revision/exposure ledger, never a causal influence classifier (moved unchanged from
 * scripts/winner-provenance.ts so the launcher's report can call it; the CLI stays there).
 * Optional vectors (text -> vector) and a fitted cosine cut enable alignment; absent vectors stay unknown.
 */
import { createHash } from "node:crypto";

type Event = Record<string, any>;
export interface Document {
  source: string; key: string; author: string; event: number; ts: string | null;
  text: string; embedded_text: string; truncated: boolean;
}
interface Revision {
  author: string; stream: string; previous: Document; current: Document;
  similarity: number | null; framing_change: "candidate" | "unaligned_candidate" | "aligned_revision";
  peer_proposals: { event: number; seq: number; author: string }[];
  peer_board_reads: { event: number; key: string; author: string }[];
  evidence_candidates: { event: number; key: string; text: string; author: string }[];
  evidence_board_reads: { event: number; key: string; author: string }[];
  work_attempts: { event: number; cls: string; target: string; participant: string }[];
  context_scope: "peer delivery versus room evidence arrivals; not evidence exposure";
  last_wake: { event: number; tool: string; outcome: string } | null;
  context: "peer_only_logged" | "evidence_only_logged" | "both_logged" | "neither_logged" | "unknown_exposure";
  exposure_coverage: "receipt_present" | "missing";
}
interface Options { vectors?: Map<string, number[]>; cut?: number; allSeats?: boolean }

export const framingText = (text: string) => text.trim().slice(0, 1200);
export const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export const stamp = (e: Event) => e.ts ?? e.msg?.ts ?? e.entry?.updatedAt ?? e.proposal?.createdAt ?? e.updatedAt ?? e.createdAt ?? null;
const FINAL = (e: Event) => e.type === "state" && e.state === "concluded";

export function parseLog(text: string): { events: Event[]; malformed: number } {
  const events: Event[] = []; let malformed = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e === "object" && !Array.isArray(e)) events.push(e);
      else malformed++;
    } catch { malformed++; }
  }
  return { events, malformed };
}

/** Claim ownership/status is coordination, not a hypothesis. Unknown prose remains available for audit. */
export function substantiveText(text: string): string {
  try {
    const j = JSON.parse(text);
    if (j && typeof j === "object" && !Array.isArray(j)) return Object.entries(j)
      .filter(([k, v]) => typeof v === "string" && !/^(owner|status|branch|worktree|reviewer|commit|item|updated_at)$/.test(k))
      .map(([, v]) => v).join(" ").trim();
  } catch { /* legacy plain-text claim */ }
  return text.trim();
}

const cosine = (a?: number[], b?: number[]): number | null => {
  if (!a || !b || !a.length || a.length !== b.length || !a.every(Number.isFinite) || !b.every(Number.isFinite)) return null;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2; }
  return na && nb ? dot / Math.sqrt(na * nb) : null;
};

function documents(events: Event[], allSeats = false) {
  const names = new Map<string, string>();
  const reverse = new Map<string, string>();
  for (const e of events) if (e.type === "join" && e.p) { names.set(e.p.id, e.p.name); reverse.set(e.p.name, e.p.id); }
  const make = (source: string, key: string, author: string, event: number, text: string): Document => ({
    source, key, author: names.get(author) ?? author, event, ts: stamp(events[event]!),
    text, embedded_text: framingText(text), truncated: text.trim().length > 1200,
  });
  const openings = new Map<string, Document>(), ideas = new Map<string, Document>(), snapshots: Document[] = [];
  const reveal = events.findIndex(e => e.type === "openings_revealed");
  const proposals = new Map<string, string>();
  const seeded = new Set<string>(); let final: Document | null = null;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type === "opening" && typeof e.content === "string" && (reveal < 0 || i < reveal)) openings.set(e.pid, make("opening", e.pid, e.pid, i, e.content));
    if (e.type === "openings_revealed") for (const key of e.ideas_seeded ?? []) seeded.add(key);
    if (e.type === "board" && typeof e.entry?.text === "string" && e.entry.text.trim()) {
      if (String(e.key).startsWith("idea/") && !ideas.has(e.key)) ideas.set(e.key, make("idea", e.key, e.entry.by ?? "unknown", i, e.entry.text));
      if (/^(claim|draft)\//.test(e.key)) {
        const text = e.key.startsWith("claim/") ? substantiveText(e.entry.text) : e.entry.text;
        if (text) snapshots.push(make(e.key.startsWith("claim/") ? "claim" : "draft", e.key, e.entry.by ?? "unknown", i, text));
      }
    }
    if (e.type === "proposal" && typeof e.proposal?.text === "string") {
      proposals.set(e.proposal.id, e.proposal.by?.id ?? e.proposal.by?.name ?? "unknown");
      snapshots.push(make("proposal", e.proposal.id, proposals.get(e.proposal.id)!, i, e.proposal.text));
    }
    if (e.type === "amend" && typeof e.text === "string") {
      // Legacy amend records omit the actor. Only its adjacent matching message/call can supply it.
      let actor = "unknown";
      for (let j = i + 1; j < Math.min(events.length, i + 5); j++) {
        const n = events[j]!;
        if (n.type === "amend" || n.type === "proposal") break;
        if (n.type === "message" && n.msg?.kind === "amend" && n.msg.proposalId === e.proposalId) { actor = n.msg.from?.id ?? "unknown"; break; }
        if (n.type === "call_completion" && n.tool === "amend" && n.outcome === "success") { actor = n.participant ?? "unknown"; break; }
      }
      snapshots.push(make("amend", e.proposalId, actor, i, e.text));
    }
    if (FINAL(e) && typeof e.conclusion?.text === "string") final = make("conclusion", "conclusion", "room", i, e.conclusion.text);
  }
  const excluded = new Set(events.filter(e => e.type === "join" && (e.p?.agent === "human" || ["chair", "verifier"].includes(e.p?.role) || e.p?.name === "verifier"))
    .map(e => e.p.name));
  return { sealed_openings: openings.size, openings: [...openings.values()].filter(s => allSeats || !excluded.has(s.author)), ideas: [...ideas.values()],
    seeded: [...ideas.values()].filter(d => seeded.has(d.key) && (allSeats || !excluded.has(d.author))),
    snapshots: snapshots.filter(s => allSeats || !excluded.has(s.author)), final, names, reverse };
}

/** Reconstruct only what receipts show: cursor passage by itself can skip quiet/withheld bodies. */
function revisionContext(events: Event[], previous: Document, current: Document, pid: string) {
  const delivered = new Set<number>(), peers: Revision["peer_proposals"] = [], reads: Revision["peer_board_reads"] = [];
  const evidence: Revision["evidence_candidates"] = [], attempts: Revision["work_attempts"] = [];
  const messages = new Map<number, { event: number; msg: Event }>();
  const board = new Map<string, { text: string; by: string; event: number }>();
  let receipt = false, lastWake: Revision["last_wake"] = null;
  for (let i = 0; i < current.event; i++) {
    const e = events[i]!;
    if (e.type === "message" && e.msg) messages.set(e.msg.seq, { event: i, msg: e.msg });
    if (e.type === "board" && e.entry) board.set(e.key, { text: e.entry.text ?? "", by: e.entry.by ?? "unknown", event: i });
    if (e.type === "attention" && e.pid === pid) {
      const withheld = new Set(e.withheld ?? []), quiet = new Set(e.quietReceipts ?? []);
      if (i > previous.event) receipt = true;
      for (const [seq, m] of messages) {
        const seen = seq <= e.lastSeenSeq && !withheld.has(seq) && (!m.msg.quiet || quiet.has(seq));
        if (seen && !delivered.has(seq) && i > previous.event && m.msg.from?.id !== pid && /^(proposal|amend)$/.test(m.msg.kind)) {
          peers.push({ event: m.event, seq, author: m.msg.from?.name ?? m.msg.from?.id ?? "unknown" });
        }
        if (seen) delivered.add(seq);
      }
    }
    if (i <= previous.event) continue;
    if (e.type === "call_completion" && e.participant === pid) {
      if (["wait_for_messages", "read_messages", "send_message", "board_get"].includes(e.tool)) lastWake = { event: i, tool: e.tool, outcome: e.outcome };
      if (e.tool === "board_get" && e.outcome === "success" && typeof e.key === "string") {
        const entry = board.get(e.key);
        if (entry && entry.by !== current.author && entry.text.trim()) reads.push({ event: i, key: e.key, author: entry.by });
      }
    }
    if (e.type === "work") attempts.push({ event: i, cls: e.cls ?? "unknown", target: e.target ?? "", participant: e.pid ?? "unknown" });
    if (e.type === "board" && /^(evidence|result|findings|verify|review)\//.test(e.key ?? "") && e.entry?.text?.trim()) {
      evidence.push({ event: i, key: e.key, text: e.entry.text, author: e.entry.by ?? "unknown" });
    }
  }
  // A retrieved board key is known, but not a complete receipt for the room's other delivered messages.
  const peer = !!peers.length || reads.some(r => /^(draft|position|decision|design|hypothesis|plan)\//.test(r.key));
  const context: Revision["context"] = !receipt ? "unknown_exposure" : peer && evidence.length ? "both_logged"
    : peer ? "peer_only_logged" : evidence.length ? "evidence_only_logged" : "neither_logged";
  return { peer_proposals: peers, peer_board_reads: reads, evidence_candidates: evidence,
    evidence_board_reads: reads.filter(r => /^(evidence|result|findings|verify|review)\//.test(r.key)),
    context_scope: "peer delivery versus room evidence arrivals; not evidence exposure" as const,
    work_attempts: attempts, last_wake: lastWake, context, exposure_coverage: receipt ? "receipt_present" as const : "missing" as const };
}

export function provenance(events: Event[], room: string, options: Options = {}) {
  const d = documents(events, options.allSeats), vectors = options.vectors ?? new Map<string, number[]>();
  const score = (a: Document, b: Document) => cosine(vectors.get(a.embedded_text), vectors.get(b.embedded_text));
  const nearest = (sources: Document[]) => d.final ? sources.map(s => ({ ...s, similarity: score(d.final!, s) }))
    .sort((a, b) => (b.similarity ?? -2) - (a.similarity ?? -2)) : [];
  const openingMatches = nearest(d.openings), seededMatches = nearest(d.seeded);
  const pass = (v: number | null | undefined) => options.cut !== undefined && v !== null && v !== undefined && v >= options.cut;
  const openingAligned = pass(openingMatches[0]?.similarity), seededAligned = pass(seededMatches[0]?.similarity);
  const origin = openingAligned && seededAligned ? "both_aligned" : openingAligned ? "opening_aligned" : seededAligned ? "alternative_aligned" : "unknown";
  const previous = new Map<string, Document>(), revisions: Revision[] = [];
  for (const s of d.snapshots) {
    const stream = /^(proposal|amend)$/.test(s.source) ? `proposal/${s.key}` : s.key;
    const key = `${s.author}\0${stream}`, before = previous.get(key);
    previous.set(key, s);
    if (!before || before.text === s.text || s.author === "unknown") continue;
    const similarity = score(before, s), pid = d.reverse.get(s.author) ?? s.author;
    revisions.push({ author: s.author, stream, previous: before, current: s, similarity,
      framing_change: similarity === null || options.cut === undefined ? "candidate" : similarity < options.cut ? "unaligned_candidate" : "aligned_revision",
      ...revisionContext(events, before, s, pid) });
  }
  const namesKey = (text: string, key: string) => new RegExp(`(^|[^\\w./-])${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w/-]|\\.\\w)`).test(text);
  const roomEvent = events.find(e => e.type === "room");
  const brief = roomEvent ? { text: String(roomEvent.opts?.topic ?? ""), embedded_text: framingText(String(roomEvent.opts?.topic ?? "")) } : null;
  const workers = new Set(events.filter(e => e.type === "join" && e.p?.agent !== "human" && !["chair", "verifier"].includes(e.p?.role))
    .map(e => e.p.session ?? e.p.id));
  return { room, concluded: !!d.final, eligible_main: /^swarm-\d{6}-[a-z0-9]{4}-/.test(room) && !!d.final && workers.size >= 2 && d.sealed_openings >= 2,
    sealed_openings: d.sealed_openings,
    parent: roomEvent?.opts?.parent ?? roomEvent?.parent ?? null,
    itemized: events.some(e => e.type === "board" && String(e.key).startsWith("item/")) || /starting area|seat.target|per.seat/i.test(brief?.text ?? ""),
    openings: d.openings, seeded: d.seeded, final: d.final, snapshots: d.snapshots, origin,
    opening_matches: openingMatches, seeded_matches: seededMatches,
    brief_similarity: d.final && brief ? cosine(vectors.get(d.final.embedded_text), vectors.get(brief.embedded_text)) : null,
    named_ideas: d.ideas.filter(s => d.final && namesKey(d.final.text, s.key)).map(s => s.key),
    revisions, truncation: { openings: d.openings.filter(s => s.truncated).length, seeded: d.seeded.filter(s => s.truncated).length,
      snapshots: d.snapshots.filter(s => s.truncated).length, conclusion: d.final?.truncated ?? false },
    brief, vector_coverage: { available: [...d.openings, ...d.seeded, ...(d.final ? [d.final] : [])].filter(s => vectors.has(s.embedded_text)).length,
      requested: d.openings.length + d.seeded.length + (d.final ? 1 : 0) } };
}
