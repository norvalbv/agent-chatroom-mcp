/** The report says what each seat did and why a run did not conclude; before this it printed "_no consensus reached_" for every cause and no per-seat row. */
import assert from 'node:assert/strict';
const { seatScorecard, classifyOutcome, renderRunReport } = await import('../src/result.js');
assert.equal(typeof seatScorecard, 'function', 'result.ts exports seatScorecard');
assert.equal(typeof classifyOutcome, 'function', 'result.ts exports classifyOutcome');

const seat = (name: string, extra: Record<string, unknown> = {}) => ({ name, agent: 'claude', role: 'worker', active: false, messages: 0, left_reason: null, ...extra });
const payload = {
  state: 'open',
  conclusion: null,
  participants: [
    seat('builder', { messages: 14, left_reason: 'Built and committed; handoff/x on the board.' }),
    seat('voter', { messages: 1, left_reason: 'seat process exited (exit 1, launcher receipt)' }),
    seat('ghost'),
    seat('stuck', { messages: 3 }),
    seat('booted', { messages: 2, left_reason: 'kicked (a kick vote started by builder): dead session' }),
    seat('live', { messages: 4, active: true }),
    seat('verifier', { role: 'verifier', messages: 2, left_reason: 'VERIFIED' }),
    seat('owner', { agent: 'human', role: 'chair', active: true }),
  ],
  board: {
    'claim/core': { by: 'builder', text: '{}' },
    'evidence/core': { by: 'builder', text: 'x' },
    'verify/core': { by: 'verifier', text: '{}' },
    'claim/idle': { by: 'stuck', text: '{}' },
  },
  proposals: [{
    id: 'prop_1', by: 'builder', version: 3, status: 'open',
    challenges: [{ id: 'ch_1', by: 'verifier', objection: 'x' }],
    votes: [{ name: 'verifier', vote: 'disagree' }, { name: 'voter', vote: 'agree' }],
    blocked_by: ['needs a verify/* entry by someone else'], waiting_on: ['stuck', 'live'],
  }],
};
const rooms = [{ name: 'lead', payload, error: null, transcript: { text: 'T', sourceUrl: 'u', error: null } }];
const receipts = { builder: { exitCode: 0, cost: 6.25 }, voter: { exitCode: 1, cost: 0.5 }, ghost: { exitCode: null, killedAtTimeout: true }, stuck: { exitCode: null, killedAtTimeout: true, cost: 3 } };

const card = seatScorecard(rooms, receipts);
const by = (n: string) => card.find((s: { name: string }) => s.name === n)!;
assert.deepEqual(card.map((s: { name: string }) => s.name), ['builder', 'voter', 'ghost', 'stuck', 'booted', 'live', 'verifier'], 'one row per agent seat, humans excluded, room order kept');
assert.deepEqual(by('builder').board, { claim: 1, verify: 0, other: 1 });
assert.equal(by('builder').proposals, 1);
assert.equal(by('builder').ending, 'left');
assert.equal(by('builder').cost, 6.25);
assert.equal(by('builder').produced, true);
assert.equal(by('voter').ending, 'exited_without_leaving');
assert.equal(by('voter').votes, 1);
assert.equal(by('voter').exitCode, 1);
assert.equal(by('voter').produced, false, 'one message and a vote is not output');
assert.equal(by('ghost').ending, 'killed_at_timeout');
assert.equal(by('ghost').produced, false);
assert.equal(by('ghost').cost, undefined, 'unknown cost is absent, never zero');
assert.equal(by('stuck').ending, 'killed_at_timeout');
assert.equal(by('stuck').produced, false, 'a claim is a promise, not output: 10 of 271 past claimants never delivered');
assert.equal(by('booted').ending, 'kicked');
assert.equal(by('live').ending, 'still_active');
assert.equal(by('live').produced, false, 'four messages and nothing on the board is talk, not output');
assert.equal(by('verifier').challenges, 1);
assert.equal(by('verifier').board.verify, 1);
// without a launcher receipt the cause of a silent exit is unknown, and says so
assert.equal(seatScorecard(rooms).find((s: { name: string }) => s.name === 'ghost')!.ending, 'gone_no_reason');

assert.equal(by('verifier').produced, true, "a verifier's vote is its output");
// a lead sits in its group room and the leads room: one row, counts summed, never named idle for the quiet room
const two = seatScorecard([
  { name: 'leads', payload: { participants: [seat('lead-a', { messages: 1, left_reason: 'done' })], board: {}, proposals: [] }, error: null, transcript: rooms[0].transcript },
  { name: 'group-a', payload: { participants: [seat('lead-a', { messages: 9 })], board: { 'evidence/a': { by: 'lead-a' } }, proposals: [{ id: 'p', by: 'lead-a', votes: [], challenges: [] }] }, error: null, transcript: rooms[0].transcript },
], { 'lead-a': { exitCode: 0, cost: 6.25 } });
assert.equal(two.length, 1, 'one row per seat, not per (seat, room)');
assert.deepEqual(two[0].rooms, ['leads', 'group-a']);
assert.equal(two[0].messages, 10);
assert.equal(two[0].proposals, 1);
assert.equal(two[0].board.other, 1);
assert.equal(two[0].produced, true);
assert.equal(two[0].ending, 'left', 'the lead room says how the seat ended');
assert.equal(two[0].cost, 6.25);

// a builder's output is commits on its branch: a claim plus commits is delivery even with nothing else on the board
const built = seatScorecard(rooms, { ...receipts, stuck: { exitCode: 0, commits: 3 } });
assert.equal(built.find((s: { name: string }) => s.name === 'stuck')!.produced, true);
assert.equal(built.find((s: { name: string }) => s.name === 'stuck')!.commits, 3);
assert.equal(by('stuck').commits, undefined, 'no branch: unknown, not zero');

// outcome: every non-conclusion names its cause
const open = classifyOutcome(payload, { timedOut: true });
assert.equal(open.kind, 'proposal_open');
assert.match(open.detail, /timed out/);
assert.match(open.detail, /prop_1 v3/);
assert.match(open.detail, /needs a verify\/\* entry by someone else/);
assert.match(open.detail, /stuck, live/);
const none = classifyOutcome({ ...payload, proposals: [] }, { timedOut: true });
assert.equal(none.kind, 'no_proposal');
assert.match(none.detail, /timed out/);
assert.match(none.detail, /nobody proposed/);
assert.equal(classifyOutcome({ ...payload, proposals: [] }, { timedOut: false }).kind, 'no_proposal');
assert.match(classifyOutcome({ ...payload, proposals: [] }, { timedOut: false }).detail, /every seat exited/);
assert.equal(classifyOutcome(null, {}).kind, 'room_missing');
assert.equal(classifyOutcome({ state: 'concluded', conclusion: { text: 'done' } }, {}).kind, 'concluded');

// report: the cause replaces the bare "_no consensus reached_", and a Seats table is printed
const artifact: any = { schemaVersion: 1, run: { id: 's', startedAt: 'a', completedAt: 'b', task: 't', doneWhen: 'd' }, project: { cwd: '.', canonicalPath: '.', git: null }, leadRoom: 'lead', rooms, verifier: { name: 'verifier', output: null }, reportPath: 'r', artifactPath: 'a', outcome: open, scorecard: card };
const md = renderRunReport(artifact);
assert.ok(md.includes(open.detail), 'report states why the run did not conclude');
assert.ok(md.includes('## Seats'), 'report has a Seats section');
assert.match(md, /\| builder \|.*\| left \|/);
assert.match(md, /\| builder \| worker \| 14 \| 1\/0\/1 \| - \| 1 \|/, 'commits column prints - when the seat had no branch');
assert.match(md, /\| ghost \|.*killed at timeout.*no output/);
assert.match(md, /\| stuck \|.*claimed, delivered nothing/);
assert.match(md, /\| live \|.*talk only/);
assert.match(md, /7 seat\(s\); 5 delivered nothing \(voter, ghost, stuck, booted, live\)/);
assert.ok(md.indexOf('## Seats') < md.indexOf('## Transcripts'), 'seats come before the transcript dump');
// an artifact written before this change still renders
const old = { ...artifact }; delete old.outcome; delete old.scorecard;
assert.ok(renderRunReport(old).includes('_no consensus reached_'));
assert.ok(!renderRunReport(old).includes('## Seats'));
console.log('SEAT SCORECARD REGRESSION OK');
