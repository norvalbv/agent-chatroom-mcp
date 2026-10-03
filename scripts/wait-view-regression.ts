/** Empty delivery is not absence of work: repeated vote hints remain actionable while unchanged state is referenced. */
import assert from 'node:assert/strict';
import { createWaitView, type WaitView } from '../src/hub/wait-view.js';
import { Hub } from '../src/hub.js';
import { createSessionServer } from '../src/server.js';

const initial = (): WaitView => ({ hint: 'Vote on the open proposal', messages: [], remaining: 0, next_seq: 8,
  room_state: 'open', your_turn: true, your_role: 'worker', leaving_would_block: false,
  active_participants: ['alice', 'bob'], humans_present: [], openings: undefined,
  open_proposal: { id: 'prop_x', version: 2, tally: { agree: 0 }, blocked_by: ['verification missing'] },
  addressed_to_you: [], unanswered_human: null, quiet_activity: [], conclusion: null });
const compact = createWaitView(); const seat = {};
assert.equal(compact(seat, initial()).unchanged, undefined, 'first snapshot is complete');
const repeat = compact(seat, initial());
assert.equal(repeat.unchanged, true);
assert.equal(repeat.hint, initial().hint, 'owed action is still in the current result');
assert.deepEqual(repeat.open_proposal, { id: 'prop_x', version: 2, unchanged: true });
assert.equal(repeat.leaving_would_block, false);
assert.equal(compact({}, initial()).unchanged, undefined, 'another identity starts with full state');
assert.equal(createWaitView()(seat, initial()).unchanged, undefined, 'another connection starts with full state');
const variants: Record<string, Partial<WaitView>> = {
  messages: { messages: ['new evidence'] }, backlog: { remaining: 1 }, board: { board_delta: { keys: ['verify/x'], tombstones: [] } },
  reset: { board_keys: [], board_reset: true }, quiet: { quiet_activity: [{ last_seq: 9 }] },
  ask: { addressed_to_you: [{ id: 'm_new' }] }, human: { unanswered_human: { text: 'question' } },
  roster: { active_participants: ['alice', 'bob', 'carol'] }, role: { your_role: 'verifier' },
  opening: { openings: { submitted: 2 } }, turn: { your_turn: false }, leave: { leaving_would_block: 'team floor' },
  blocker: { open_proposal: { id: 'prop_x', version: 2, tally: { agree: 0 }, blocked_by: [] } },
  vote: { open_proposal: { id: 'prop_x', version: 2, tally: { agree: 1 }, blocked_by: ['verification missing'] } },
  version: { open_proposal: { id: 'prop_x', version: 3 } }, conclusion: { room_state: 'concluded', conclusion: { text: 'done' } },
};
for (const [name, change] of Object.entries(variants)) {
  const render = createWaitView(); render(seat, initial());
  const next = { ...initial(), ...change };
  assert.equal(render(seat, next), next, `${name} is delivered in full`);
}
const reveal = createWaitView();
reveal(seat, { ...initial(), openings: { submitted: 1, revealed: false } });
assert.equal(reveal(seat, initial()).unchanged, undefined, 'full response clears removed openings');
const humanFocus = createWaitView();
humanFocus(seat, initial());
humanFocus(seat, { ...initial(), active_participants: undefined, open_proposal: null,
  unanswered_human: { text: 'hello' }, addressed_to_you: [{ id: 'human-1' }] });
assert.equal(humanFocus(seat, initial()).unchanged, undefined, 'a stripped human view resets the normal snapshot');
const hub = new Hub(); const session = createSessionServer(hub);
const call = async (tool: string, args: Record<string, unknown>) => {
  const out = await (session.server as any)._registeredTools[tool].handler(args, {});
  assert.ok(!out.isError, out.content[0].text); return JSON.parse(out.content[0].text);
};
try {
  const room = 'wait-view'; const a = await call('join_room', { room, name: 'alice', agent: 'test' });
  const b = await call('join_room', { room, name: 'bob', agent: 'test' });
  for (const p of [a, b]) await call('wait_for_messages', { room, participant_id: p.participant_id, timeout_ms: 0 });
  assert.equal((await call('wait_for_messages', { room, participant_id: a.participant_id, timeout_ms: 0 })).unchanged, true);
  await call('join_room', { room, name: 'alice', agent: 'test', participant_id: a.participant_id });
  assert.equal((await call('wait_for_messages', { room, participant_id: a.participant_id, timeout_ms: 0 })).unchanged, undefined, 'rejoin resets full board/state delivery');
} finally { await session.server.close(); }
console.log(`WAIT VIEW OK (${Object.keys(variants).length} changed-state controls)`);
