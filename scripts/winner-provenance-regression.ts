/** Fixture logs exercise ancestry uncertainty, revision identity and delivery debt. */
import assert from "node:assert/strict";
import { parseLog, provenance, substantiveText } from "./winner-provenance.ts";

const at = (n: number) => new Date(Date.UTC(2026, 9, 29, 12, n)).toISOString();
const msg = (seq: number, kind: string, pid: string, content: string, extra = {}) => ({
  type: "message", msg: { seq, id: `m_${seq}`, kind, from: { id: pid, name: pid }, content, ts: at(seq), ...extra },
});
const board = (key: string, text: string, by = "a") => ({ type: "board", key, entry: { text, by, updatedAt: at(5) } });
const events = [
  { type: "room", room: "fixture", createdAt: at(0), opts: { topic: "Choose A or B." } },
  { type: "join", p: { id: "a", name: "a", agent: "codex" } },
  { type: "join", p: { id: "b", name: "b", agent: "claude" } },
  { type: "opening", pid: "a", content: "Try A first." },
  { type: "opening", pid: "b", content: "Try B first." },
  board("idea/b", "Try B first.", "b"),
  { type: "openings_revealed", ideas_seeded: ["idea/b"] },
  board("claim/work", '{"description":"Implement A", "status":"active","owner":"a"}'),
  board("claim/work", '{"description":"Implement A", "status":"done","owner":"a"}'),
  { type: "proposal", proposal: { id: "p", by: { id: "b", name: "b" }, text: "Try B first.", createdAt: at(2) } },
  msg(2, "proposal", "b", "PROPOSAL p: Try B first.", { proposalId: "p" }),
  // A cursor can pass a body still withheld; this is not exposure.
  { type: "attention", pid: "a", lastSeenSeq: 2, withheld: [2], quietReceipts: [] },
  { type: "call_completion", participant: "a", tool: "wait_for_messages", outcome: "success", ts: at(3) },
  { type: "work", pid: "a", cls: "run", target: "npm test", ts: at(4) },
  board("claim/work", '{"description":"Implement B","status":"active"}'),
  { type: "amend", proposalId: "p", text: "Try C first.", updatedAt: at(6) },
  msg(6, "amend", "a", "AMENDED p to v2", { proposalId: "p" }),
  { type: "call_completion", participant: "a", tool: "amend", outcome: "success", ts: at(6) },
  { type: "state", state: "concluded", conclusion: { text: "Try C first." } },
];

const parsed = parseLog(events.map(e => JSON.stringify(e)).join("\n") + '\n{"partial":');
assert.equal(parsed.events.length, events.length);
assert.equal(parsed.malformed, 1, "a partial tail is visible, never silently zero evidence");
assert.equal(substantiveText('{"description":"Implement A","status":"done","branch":"x"}'), "Implement A");
const row = provenance(parsed.events, "fixture");
assert.equal(row.origin, "unknown", "without fitted vectors absence is not a novel winning frame");
assert.equal(row.revisions.filter(x => x.stream === "claim/work").length, 1, "status-only updates are not revisions");
const claim = row.revisions.find(x => x.stream === "claim/work")!;
assert.equal(claim.peer_proposals.length, 0, "withheld proposal body is not delivered");
assert.equal(claim.work_attempts.length, 1);
assert.equal(claim.evidence_candidates.length, 0, "running a command is not a result");
assert.equal(claim.context, "neither_logged", "a descriptive record, never a causal claim");
assert.equal(row.snapshots.find(x => x.source === "amend")?.author, "a", "amend actor is not inferred from proposer");

const vectors = new Map([
  ["Try A first.", [1, 0, 0]], ["Try B first.", [0, 1, 0]], ["Try C first.", [0, 0, 1]],
]);
assert.equal(provenance(events, "fixture", { vectors, cut: 0.8 }).origin, "unknown", "unaligned final stays unknown, not born midroom");
const finalB = [...events.slice(0, -1), { type: "state", state: "concluded", conclusion: { text: "Try B first." } }];
const aligned = provenance(finalB, "fixture", { vectors, cut: 0.8 });
assert.equal(aligned.origin, "both_aligned");
assert.equal(aligned.opening_matches[0]?.author, "b");
assert.equal(aligned.seeded_matches[0]?.key, "idea/b");

const delivered = structuredClone(events);
const attention = delivered.find(x => x.type === "attention") as any;
attention.withheld = [];
const withResult = delivered.slice();
const revisionIndex = withResult.findIndex((x: any) => x.type === "board" && x.entry?.text.includes("Implement B"));
withResult.splice(revisionIndex, 0, board("evidence/check", "Command: npm test. Result: 2 failed assertions.", "b"));
const exposed = provenance(withResult, "fixture").revisions.find(x => x.stream === "claim/work")!;
assert.equal(exposed.peer_proposals.length, 1);
assert.equal(exposed.evidence_candidates.length, 1);
assert.equal(exposed.context, "both_logged");
assert.equal(exposed.evidence_candidates[0]?.author, "b");
assert.equal(exposed.evidence_board_reads.length, 0, "room arrival need not be read by the changing seat");

const refused = structuredClone(delivered);
const wake = refused.find(x => x.type === "call_completion" && (x as any).tool === "wait_for_messages") as any;
wake.tool = "send_message";
wake.outcome = "hub_refusal";
const refusedRevision = provenance(refused, "fixture").revisions.find(x => x.stream === "claim/work")!;
assert.equal(refusedRevision.peer_proposals.length, 1, "refused sends can deliver unread proposal text");
assert.equal(refusedRevision.last_wake?.outcome, "hub_refusal");

const quiet = structuredClone(delivered);
(quiet.find(x => x.type === "message") as any).msg.quiet = true;
assert.equal(provenance(quiet, "fixture").revisions[0]?.peer_proposals.length, 0, "quiet bystander stub is not a body");
(quiet.find(x => x.type === "attention") as any).quietReceipts = [2];
assert.equal(provenance(quiet, "fixture").revisions[0]?.peer_proposals.length, 1, "explicit quiet receipt confirms the body");

const retrieved = structuredClone(events);
retrieved.splice(revisionIndex, 0, board("draft/b", "Try B first.", "b"),
  { type: "call_completion", participant: "a", tool: "board_get", key: "draft/b", outcome: "success", ts: at(4) } as any);
const readRevision = provenance(retrieved, "fixture").revisions.find(x => x.stream === "claim/work")!;
assert.equal(readRevision.peer_board_reads.length, 1, "direct peer draft retrieval has a separate exposure channel");
assert.equal(readRevision.context, "peer_only_logged");
assert.equal(provenance(events.filter(x => x.type !== "attention"), "fixture").revisions[0]?.context, "unknown_exposure");

const long = [...events.slice(0, -1), { type: "state", state: "concluded", conclusion: { text: "x".repeat(1300) } }];
const lossy = provenance(long, "fixture");
assert.equal(lossy.final?.text.length, 1300, "full text retained for manual audit");
assert.equal(lossy.final?.embedded_text.length, 1200);
assert.equal(lossy.truncation.conclusion, true);

// Key mentions are citations, including rejection, not endorsement; prefixes do not count.
const named = [...finalB.slice(0, -1), { type: "state", state: "concluded", conclusion: { text: "Drop idea/b-2, not our branch." } }];
assert.deepEqual(provenance(named, "fixture").named_ideas, []);
named[named.length - 1] = { type: "state", state: "concluded", conclusion: { text: "Drop idea/b." } };
assert.deepEqual(provenance(named, "fixture").named_ideas, ["idea/b"]);
assert.equal(provenance([], "empty").concluded, false);
const verifierOpening = [{ type: "join", p: { id: "v", name: "verifier", agent: "claude" } },
  { type: "opening", pid: "v", content: "I will check the tests." }, ...events];
assert.equal(provenance(verifierOpening, "fixture").openings.length, 2, "legacy verifier-policy opening is not a worker framing");
assert.equal(provenance(verifierOpening, "fixture", { allSeats: true }).openings.length, 3, "all-seat sensitivity remains available");
const replacedOpening = [...events.slice(0, 3), { type: "opening", pid: "a", content: "Retracted frame." }, ...events.slice(3)];
const replaced = provenance(replacedOpening, "fixture");
assert.equal(replaced.openings.length, 2, "reveal holds the last opening per participant, not each submitted version");
assert.equal(replaced.openings.some(x => x.text === "Retracted frame."), false);
const legacyLead = structuredClone(events);
((legacyLead.find((x: any) => x.type === "join" && x.p.id === "b") as any).p).name = "verifier";
const leadRow = provenance(legacyLead, "swarm-123456-abcd-room");
assert.equal(leadRow.openings.length, 1, "legacy verifier-policy text is excluded from alignment");
assert.equal(leadRow.eligible_main, true, "worker text filtering must not alter the preregistered population denominator");
for (const [key, by] of [["resource/benchmarks", "b"], ["item/work", "b"], ["claim/other", "b"], ["take/check", "b"], ["evidence/check", "launcher"], ["draft/seed", "system"]]) {
  const coordination = structuredClone(events);
  coordination.splice(revisionIndex, 0, board(key!, "Choose B on this task.", by),
    { type: "call_completion", participant: "a", tool: "board_get", key, outcome: "success", ts: at(4) } as any);
  const revision = provenance(coordination, "fixture").revisions.find(x => x.stream === "claim/work")! as any;
  assert.equal(revision.trigger, "unknown", `${by}:${key} is coordination or non-peer content, not a known trigger channel`);
}
const explicit = structuredClone(events).filter(x => x.type !== "attention");
const pivotAt = explicit.findIndex((x: any) => x.type === "board" && x.entry?.text.includes("Implement B"));
explicit.splice(pivotAt, 0, { type: "delivery_receipt", participant: "a", seat: "a", via: "wait", boundary: "hub_handoff", seq_ranges: [[2, 2]], count: 1, ts: at(3) } as any);
const explicitRevision = provenance(explicit, "fixture").revisions.find(x => x.stream === "claim/work")! as any;
assert.equal(explicitRevision.trigger, "known_message", "an explicit receipt before the revision establishes a message exposure candidate");
assert.equal(explicitRevision.receipt_basis, "explicit");
assert.equal(explicitRevision.peer_deliveries[0]?.seq, 2);
assert.equal(explicitRevision.peer_deliveries[0]?.via, "wait");
assert.match(explicitRevision.trigger_note, /causality unproven/);
assert.equal((claim as any).trigger, "unknown", "legacy cursor inference has no exact receipt timing");
const tooLate = structuredClone(explicit);
const receiptAt = tooLate.findIndex(x => x.type === "delivery_receipt");
const lateReceipt = tooLate.splice(receiptAt, 1)[0]!;
tooLate.push(lateReceipt);
assert.equal((provenance(tooLate, "fixture").revisions.find(x => x.stream === "claim/work")! as any).trigger, "unknown", "a later receipt cannot explain an earlier revision");
const chatOnly = structuredClone(explicit);
(chatOnly.find(x => x.type === "message") as any).msg.kind = "chat";
const chatRevision = provenance(chatOnly, "fixture").revisions.find(x => x.stream === "claim/work")! as any;
assert.equal(chatRevision.peer_proposals.length, 0);
assert.equal(chatRevision.peer_deliveries.length, 1, "ordinary peer chat is a possible temporal trigger too");
assert.equal(chatRevision.context, "peer_only_logged");
assert.equal((readRevision as any).trigger, "known_board", "an explicit peer draft read is a separate board channel");
assert.equal((readRevision as any).trigger_board_reads.length, 1);
console.log("winner-provenance-regression: OK");
