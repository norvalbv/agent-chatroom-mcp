/**
 * The runs table says how each room closed (evidence-pack item 1; evidence/ab-last-call-verifier-gate). The A/B that
 * measured the last call and the verifier gate needed a one-off script (/tmp/c1/ab_metrics.mjs) to count, at each
 * conclusion, whether the verifier had agreed to the final version and how many seats had not voted on it. The next
 * rooms compare builds with scripts/runs-table.ts, so the table now carries it: from conclusion.closing when the log has
 * it (hubs with the last call), else derived from the join, vote and amend events (older logs).
 * Red on main: RunRow has no close. Run: npx tsx scripts/runs-table-close-regression.ts
 */
import assert from "node:assert/strict";
import { renderRunsTable, runRow } from "../src/run-timeline.js";

const T = (s: number) => new Date(Date.UTC(2026, 9, 11, 19, 0, s)).toISOString();
const join = (id: string, name: string, role?: string) => ({ type: "join", room: "r", p: { id, name, agent: "claude", ...(role ? { role } : {}), joinedAt: T(0) } });
const vote = (pid: string, name: string, v: string, version: number, s: number) => ({ type: "vote", room: "r", proposalId: "prop_1", pid, entry: { vote: v, name, ts: T(s), version } });
const base = [
  { type: "room", room: "r", opts: { topic: "pick a flag name" }, createdAt: T(0) },
  join("a", "A"), join("b", "B"), join("c", "C"), join("v", "verifier", "verifier"),
  { type: "proposal", proposal: { id: "prop_1", createdAt: T(10), version: 1, votes: { a: { vote: "agree", name: "A", ts: T(10), version: 1 } }, status: "open" } },
];

// an OLD log (no closing): the verifier disagreed, C never voted on v2, the room concluded anyway
const old = runRow([
  ...base,
  vote("v", "verifier", "disagree", 1, 20),
  { type: "amend", room: "r", proposalId: "prop_1", version: 2, updatedAt: T(30), votes: { a: { vote: "agree", name: "A", ts: T(10), version: 1, quote: "x" } } },
  vote("a", "A", "agree", 2, 31), vote("b", "B", "agree", 2, 32),
  { type: "state", room: "r", state: "concluded", conclusion: { decidedAt: T(33), proposalId: "prop_1", version: 2 } },
] as never);
assert.deepEqual(old.close, { version: 2, notVotedOnFinal: 2, electorate: 4, verifierAgreed: false, source: "events" }, "C and the verifier had not voted on v2; the verifier had not agreed");

// a NEW log: conclusion.closing is the record
const fresh = runRow([
  ...base,
  vote("b", "B", "agree", 1, 20), vote("c", "C", "agree", 1, 21), vote("v", "verifier", "agree", 1, 25),
  { type: "state", room: "r", state: "concluded", conclusion: { decidedAt: T(26), proposalId: "prop_1", version: 1,
    closing: { verifier: { name: "verifier", agreed: true, vote: "agree", version: 1 }, seconds_from_proposal: 16, seconds_from_last_text: 16, last_call_seconds: 4, ended: "all_voted", not_voted_on_final: [] } } },
] as never);
assert.deepEqual(fresh.close, { version: 1, notVotedOnFinal: 0, electorate: 4, verifierAgreed: true, lastCallSeconds: 4, source: "closing" });

// no verifier seat: verifierAgreed is null, not false
const noV = runRow([
  { type: "room", room: "r", opts: { topic: "t" }, createdAt: T(0) }, join("a", "A"), join("b", "B"),
  { type: "proposal", proposal: { id: "prop_1", createdAt: T(10), version: 1, votes: { a: { vote: "agree", name: "A", ts: T(10), version: 1 } }, status: "open" } },
  vote("b", "B", "agree", 1, 12),
  { type: "state", room: "r", state: "concluded", conclusion: { decidedAt: T(13), proposalId: "prop_1", version: 1 } },
] as never);
assert.equal(noV.close?.verifierAgreed, null);

const table = renderRunsTable([old, fresh]);
assert.match(table, /\| at the close \|/, "the table has the column");
assert.match(table, /2 of 4 unvoted, verifier did not agree/);
assert.match(table, /0 of 4 unvoted, verifier agreed, last call 4 s/);
console.log("runs-table-close-regression OK");
