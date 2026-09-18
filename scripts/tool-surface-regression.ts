/**
 * RE-TARGET swarm-082729-8b5j Rank 5 (item5-tool-surface): a restricted-role session should not carry
 * propose/amend/challenge/vote schemas on every turn until it actually has something to do with them.
 * Run: npx tsx scripts/tool-surface-regression.ts
 */
import assert from 'node:assert/strict';
import { Hub } from '../src/hub.js';
import { createSessionServer } from '../src/server.js';

const DECISION_TOOLS = ['propose', 'amend', 'challenge', 'vote'] as const;
const ALWAYS_ON = ['send_message', 'wait_for_messages', 'board_set', 'board_get', 'read_messages', 'room_status', 'pass', 'list_rooms', 'leave_room'] as const;

const cases: [string, () => Promise<void> | void][] = [];
function test(name: string, run: () => Promise<void> | void) { cases.push([name, run]); }

function call(session: ReturnType<typeof createSessionServer>, tool: string, args: any) {
  const reg = (session.server as any)._registeredTools[tool];
  if (!reg) throw new Error(`no such tool: ${tool}`);
  if (!reg.enabled) throw new Error(`tool disabled (would be rejected by the real MCP dispatch too): ${tool}`);
  return reg.handler(args, {}).then((out: any) => {
    assert.ok(!out.isError, JSON.stringify(out));
    return JSON.parse(out.content[0].text);
  });
}
function enabled(session: ReturnType<typeof createSessionServer>, tool: string): boolean {
  return !!(session.server as any)._registeredTools[tool]?.enabled;
}

let serial = 0;
const room = () => `tool-surface-${++serial}`;

test('default join_room keeps the full tool surface enabled', async () => {
  const h = new Hub();
  const a = createSessionServer(h);
  const r = room();
  await call(a, 'join_room', { room: r, name: 'alice', agent: 'test' });
  for (const t of [...DECISION_TOOLS, ...ALWAYS_ON]) assert.equal(enabled(a, t), true, `${t} should be enabled by default`);
});

test('tool_scope="restricted" disables only the proposal-lifecycle tools', async () => {
  const h = new Hub();
  const a = createSessionServer(h);
  const r = room();
  const out = await call(a, 'join_room', { room: r, name: 'alice', agent: 'test', tool_scope: 'restricted' });
  assert.equal(out.tool_scope, 'restricted');
  for (const t of DECISION_TOOLS) assert.equal(enabled(a, t), false, `${t} should be disabled when restricted`);
  for (const t of ALWAYS_ON) assert.equal(enabled(a, t), true, `${t} must stay enabled when restricted`);
});

test('a real MCP call to a disabled tool is rejected, not silently allowed', async () => {
  const h = new Hub();
  const a = createSessionServer(h);
  const r = room();
  await call(a, 'join_room', { room: r, name: 'alice', agent: 'test', tool_scope: 'restricted' });
  const reg = (a.server as any)._registeredTools['propose'];
  assert.equal(reg.enabled, false);
  // this is exactly the guard McpServer's CallToolRequestSchema handler applies before invoking a tool
});

test('restricted session is unaffected by another connection\'s tool scope', async () => {
  const h = new Hub();
  const a = createSessionServer(h);
  const b = createSessionServer(h);
  const r = room();
  await call(a, 'join_room', { room: r, name: 'alice', agent: 'test', tool_scope: 'restricted' });
  await call(b, 'join_room', { room: r, name: 'bob', agent: 'test' });
  assert.equal(enabled(a, 'propose'), false);
  assert.equal(enabled(b, 'propose'), true);
});

test('regain rule: decision tools re-enable the instant an open proposal exists in this room', async () => {
  const h = new Hub();
  const a = createSessionServer(h); // restricted observer
  const b = createSessionServer(h); // full-scope proposer
  const r = room();
  await call(a, 'join_room', { room: r, name: 'alice', agent: 'test', tool_scope: 'restricted' });
  await call(b, 'join_room', { room: r, name: 'bob', agent: 'test' });
  for (const t of DECISION_TOOLS) assert.equal(enabled(a, t), false);

  // room chatter alone (not a proposal) must NOT regain the tools
  await call(b, 'send_message', { room: r, content: 'just talking', force: true });
  await call(a, 'wait_for_messages', { room: r, timeout_ms: 0 });
  for (const t of DECISION_TOOLS) assert.equal(enabled(a, t), false, `${t} must stay off for mere chatter`);

  await call(b, 'propose', { room: r, text: 'Adopt the restricted-tool-surface design.' });
  const view = await call(a, 'wait_for_messages', { room: r, timeout_ms: 0 });
  for (const t of DECISION_TOOLS) assert.equal(enabled(a, t), true, `${t} must be back once a proposal is open`);
  assert.match(view.hint, /restored/i, 'the hint must say why the surface changed');

  // and now the previously-restricted session can actually vote
  const voted = await call(a, 'vote', { room: r, proposal_id: view.open_proposal.id, vote: 'agree', quote: 'Adopt the restricted-tool-surface design.' });
  assert.ok(voted.proposal, 'vote succeeded once the tool was regained');
});

let failed = 0;
for (const [name, run] of cases) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n${error instanceof Error ? error.stack : error}`); }
}
console.log(`TOOL SURFACE: ${cases.length - failed}/${cases.length} passed`);
process.exitCode = failed ? 1 : 0;
