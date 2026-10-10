/**
 * Round 1's headline numbers (recruit rate, minutes to first proposal, share of seat time spent polling) were computed
 * by hand by a seat writing its own script, and the run report's scorecard carried none of the hub's work ledger.
 * This pins run-metrics: the same numbers computed by code from the hub's own room log, which the hub appends as
 * events happen, so a dead launcher loses nothing. It also pins that the hub records each call's duration, without
 * which polling share cannot be computed at all.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mod = await import('../src/run-metrics.js').catch(() => null);
assert.ok(mod, 'src/run-metrics.ts exists');
const { runMetrics, renderMetrics } = mod;

const T0 = Date.parse('2026-10-10T08:00:00.000Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const seat = (id: string, name: string, joinMin: number, role = 'worker') => ({ id, name, agent: 'claude', role, joinedAt: at(joinMin), seatKeyHash: `k_${id}` });
const call = (pid: string, tool: string, min: number, ms?: number, outcome = 'success', empty?: boolean) =>
  ({ type: 'call_completion', room: 'r', tool, outcome, ts: at(min), participant: pid, ...(ms === undefined ? {} : { ms }), ...(empty === undefined ? {} : { empty }) });
const board = (key: string, by: string, min: number, text = 'x') => ({ type: 'board', room: 'r', key, entry: { text, by, updatedAt: at(min) } });
const msg = (seq: number, name: string, min: number, content: string, kind = 'chat') =>
  ({ type: 'message', msg: { seq, id: `m_${seq}`, room: 'r', kind, from: { id: name, name, agent: 'claude' }, content, ts: at(min) } });

const events = [
  { type: 'room', room: 'r', opts: {}, createdAt: at(0) },
  { type: 'join', room: 'r', p: seat('p_a', 'alice', 0) },
  { type: 'join', room: 'r', p: seat('p_b', 'bob', 0) },
  { type: 'join', room: 'r', p: seat('p_v', 'verifier', 0, 'verifier') },
  board('claim/alpha', 'alice', 2),
  board('sources/2401.00001', 'bob', 4),
  { type: 'work', room: 'r', pid: 'p_a', cls: 'read', tool: 'Read', target: 'src/a.ts', ts: at(3) },
  { type: 'work', room: 'r', pid: 'p_a', cls: 'web', tool: 'WebFetch', target: 'arxiv.org', ts: at(3) },
  { type: 'work', room: 'r', pid: 'p_a', cls: 'edit', tool: 'Edit', target: 'src/a.ts', ts: at(5) },
  { type: 'work', room: 'r', pid: 'p_b', cls: 'search', tool: 'Grep', target: 'foo', ts: at(3) },
  msg(5, 'alice', 6, 'built alpha at deadbeef12, board findings/alpha'),
  board('findings/alpha', 'alice', 6),
  call('p_a', 'request_agent', 7),
  call('p_b', 'request_agent', 7, 10, 'hub_refusal'),
  call('p_a', 'wait_for_messages', 8, 30_000, 'success', true),
  call('p_a', 'wait_for_messages', 9, 30_000, 'success', false),
  call('p_b', 'wait_for_messages', 9, 60_000, 'success', true),
  call('p_a', 'send_message', 9, 50),
  { type: 'proposal', proposal: { id: 'prop_1', room: 'r', by: { id: 'p_a', name: 'alice' }, text: 'Built alpha (deadbeef12, findings/alpha). Cites sources/2401.00001.', createdAt: at(10), votes: {}, challenges: [], status: 'open', version: 1 } },
  { type: 'challenge', room: 'r', proposalId: 'prop_1', challenge: { id: 'ch_1', by: { id: 'p_b', name: 'bob' }, objection: 'weak', ts: at(11) } },
  board('verify/alpha', 'verifier', 12, '{"proposal":"prop_1"}'),
  { type: 'vote', room: 'r', proposalId: 'prop_1', pid: 'p_v', entry: { vote: 'agree', name: 'verifier', ts: at(13) } },
  { type: 'leave', room: 'r', p: { ...seat('p_b', 'bob', 0), leftAt: at(14) } },
  // usage is cumulative per seat process (claude-opus-5-5-1's live usage): the latest event wins, never a sum
  { type: 'usage', room: 'r', seat: 'k_p_a', usage: { requests: 3, input_tokens: 100, output_tokens: 10, cost_usd: 0.5 }, ts: at(5) },
  { type: 'usage', room: 'r', seat: 'k_p_a', usage: { requests: 9, input_tokens: 400, output_tokens: 40, cost_usd: 1.25 }, ts: at(9) },
  board('notes', 'bob', 15),
  board('findings/a', 'bob', 15),
  // the hub persists the proposal again when it is accepted (swarm-083320-vya8: its dev room's own finding)
  { type: 'proposal', proposal: { id: 'prop_1', room: 'r', by: { id: 'p_a', name: 'alice' }, text: 'Built alpha (deadbeef12, findings/alpha). Cites sources/2401.00001.', createdAt: at(10), votes: {}, challenges: [], status: 'accepted', version: 1 } },
  { type: 'state', room: 'r', state: 'concluded', conclusion: { text: 'Built alpha (deadbeef12, findings/alpha). Cites sources/2401.00001. Bob fixed it in cafef00d1. See footnotes and findings/alpha. The fix is 6217618, not 1234567.', proposalId: 'prop_1', decidedAt: at(20) } },
];

// a sha is credited to its git author when the repo knows it (seats commit under their own name, src/env.ts
// seatGitIdentity), and to whoever first named it only when it does not: the first mention is often a reviewer
const shaAuthor = (sha: string) => (sha === 'cafef00d1' ? 'bob' : sha === '6217618' ? 'alice' : undefined);
const m = runMetrics(events, { shaAuthor });
assert.equal(m.room, 'r');
assert.deepEqual(m.minutesTo, { firstClaim: 2, firstSource: 4, firstProposal: 10, conclusion: 20 }, 'milestones in minutes after the room opened');
assert.deepEqual(m.recruits, { calls: 1, seats: 1, workers: 2, rate: 0.5 }, 'only a successful request_agent counts; rate is recruiting workers over workers');
const by = (n: string) => m.seats.find((s: { name: string }) => s.name === n)!;
assert.deepEqual(by('alice').work, { read: 1, search: 0, web: 1, run: 0, edit: 1 }, 'work ledger per seat, by class (distinct targets)');
assert.deepEqual(by('bob').work, { read: 0, search: 1, web: 0, run: 0, edit: 0 });
assert.equal(by('alice').waitMs, 60_000, 'wait durations summed');
assert.equal(by('alice').idleWaitMs, 30_000, 'only waits that ended with nothing new are idle polling');
// alice never left: her lifetime runs to the room's last event (20 min); bob left at 14 min
assert.equal(by('alice').pollingShare?.toFixed(3), (60_000 / (20 * 60_000)).toFixed(3));
assert.equal(by('alice').idlePollingShare?.toFixed(3), (30_000 / (20 * 60_000)).toFixed(3));
assert.equal(by('bob').idlePollingShare?.toFixed(3), (60_000 / (14 * 60_000)).toFixed(3));
assert.equal(by('alice').recruits, 1);
assert.equal(by('bob').recruits, 0, 'a refused request_agent is not a recruit');
assert.equal(by('bob').challenges, 1);
assert.equal(by('verifier').verifies, 1);
assert.equal(by('alice').proposals, 1, 'a proposal persisted again at acceptance is one proposal');
assert.equal(by('verifier').votes, 1);
assert.deepEqual(by('alice').cited.sort(), ['6217618', 'deadbeef12', 'findings/alpha'], 'the conclusion cites alice\'s board key and the sha she first named');
assert.deepEqual(by('bob').cited.sort(), ['cafef00d1', 'sources/2401.00001'], 'bob gets the sha git says he authored, though alice never named it');
assert.ok(!by('bob').cited.includes('notes') && !by('bob').cited.includes('findings/a'), 'a key is cited only as a whole token, not inside "footnotes" or "findings/alpha"');
assert.deepEqual(m.uncited, ['verifier'], 'seats that wrote board entries the conclusion never cites');
assert.equal(m.webSeats, 1, 'seats that made any web call');
assert.equal(by('alice').usage?.cost_usd, 1.25, 'latest cumulative usage per seat');
assert.equal(by('bob').usage, undefined, 'a seat that reported no usage is unknown, not zero');
assert.deepEqual(m.usage, { cost_usd: 1.25, input_tokens: 400, output_tokens: 40, seatsWithUsage: 1 });
const none = renderMetrics(runMetrics(events.filter((e) => e.type !== 'proposal' && e.type !== 'state')));
assert.ok(!none.includes('from the none') && none.includes('No proposal yet'), 'a room with no proposal says so');

// A log from before the work ledger: reads, searches and web calls are unknown, never zero.
const preLedger = runMetrics(events.filter((e) => e.type !== 'work'));
assert.equal(preLedger.webSeats, undefined, 'no ledger in the log: web seats unknown');
assert.equal(preLedger.seats[0].work, undefined, 'no ledger in the log: work unknown');

// Without durations (a log written before the hub recorded them) polling share is unknown, never zero.
const old = runMetrics(events.map((e) => (e.type === 'call_completion' ? { ...e, ms: undefined } : e)));
assert.equal(old.seats.find((s: { name: string }) => s.name === 'alice')!.pollingShare, undefined, 'no ms on the log: polling share unknown');

const text = renderMetrics(m);
assert.ok(text.includes('| 9 | 400/40 | $1.25 |'), `alice's row has model calls, tokens and cost: ${text}`);
for (const want of ['first proposal 10 min', 'recruit', 'polling', 'alice', 'cited']) assert.ok(text.includes(want), `report text names ${want}: ${text}`);

// The run report carries the section when the artifact has metrics.
const { renderRunReport } = await import('../src/result.js');
const report = renderRunReport({ schemaVersion: 1, run: { id: 'x', startedAt: at(0), completedAt: at(20), task: 't', doneWhen: 'd' }, project: { cwd: '.', canonicalPath: '.', git: null }, leadRoom: 'r', rooms: [], verifier: { name: 'verifier', output: null }, reportPath: 'r.md', artifactPath: 'r.json', metrics: m } as never);
assert.ok(report.includes('## Metrics') && report.includes('first proposal 10 min'), 'report.md has the metrics section');

// The hub writes the duration of every guarded call into its room log.
const dir = mkdtempSync(join(tmpdir(), 'run-metrics-'));
try {
  const { Hub } = await import('../src/hub.js');
  const hub = new Hub({ dataDir: dir });
  const { participant } = hub.join('r', 'alice', 'claude');
  hub.recordCallCompletion('r', 'wait_for_messages', 'success', participant.id, { ms: 1234, empty: true });
  const lines = readFileSync(join(dir, 'r.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const done = lines.filter((e) => e.type === 'call_completion');
  assert.equal(done.at(-1)?.ms, 1234, 'call_completion carries the call duration');
  assert.equal(done.at(-1)?.empty, true, 'a wait records whether it returned anything');
} finally { rmSync(dir, { recursive: true, force: true }); }

console.log('run-metrics regression OK');
