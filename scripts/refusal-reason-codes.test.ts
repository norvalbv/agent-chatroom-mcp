/** Privacy-safe refusal diagnostics, through real MCP guards.
 * Run: npx tsx scripts/refusal-reason-codes.test.ts
 * Uses isolated temporary JSONL storage; no network port or live hub.
 */
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Hub, HubError } from '../src/hub.js';
import { createSessionServer } from '../src/server.js';

const CODES = new Set(['expiry-prefix', 'ownership', 'auth', 'key-format', 'size', 'state', 'hub_guard']);
const SECRET = 'SECRET_SHOULD_NEVER_BECOME_A_REASON';
Hub.DEFAULT_NUDGE_MS = 0;

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'refusal-reasons-'));
  const hub = new Hub({ dataDir: dir });
  const clients: Client[] = [];
  const servers: ReturnType<typeof createSessionServer>[] = [];
  try {
    for (const name of ['author', 'other']) {
      const server = createSessionServer(hub);
      const client = new Client({ name, version: '1' });
      servers.push(server);
      clients.push(client);
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await server.server.connect(st);
      await client.connect(ct);
      const result = await client.callTool({name:'join_room', arguments:{room:'reasons', name, agent:'test'}});
      assert.notEqual(result.isError, true);
    }
    const call = (actor: number, args: Record<string, unknown>) => clients[actor].callTool({name:'board_set', arguments:{room:'reasons', ...args}});
    assert.notEqual((await call(0, {key:'evidence/owned', text:'original'})).isError, true);
    const failures = [
      [0, {key:`evidence/${SECRET}`, text:SECRET, ttl_seconds:1234567}],
      [1, {key:'evidence/owned', text:SECRET}],
      [0, {key:'evidence/auth', text:SECRET, participant_id:`p_${SECRET}`}],
      [0, {key:`!${SECRET}`, text:SECRET}],
      [0, {key:'evidence/large', text:SECRET.repeat(300)}],
      [0, {key:'evidence/owned', text:SECRET, if_absent:true}],
    ] as const;
    for (const [actor, args] of failures) {
      assert.equal((await call(actor, args)).isError, true, `fixture must refuse ${JSON.stringify(args).slice(0, 60)}`);
    }
    // Unknown and misleading raw error text must not be parsed into a category.
    const original = hub.setBoard;
    hub.setBoard = () => { throw new HubError(`ownership expiry-prefix ${SECRET}`, {secret:SECRET}); };
    try { assert.equal((await call(0, {key:'evidence/unknown', text:SECRET})).isError, true); }
    finally { hub.setBoard = original; }
    const path = join(dir, 'reasons.jsonl');
    const events = readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const refusals = events.filter(event => event.type === 'refusal');
    assert.equal(refusals.length, 7);
    return {hub, dir, path, refusals, cleanup: async () => {
      for (const client of clients) await client.close();
      for (const server of servers) await server.server.close();
      rmSync(dir, {recursive:true, force:true});
    }};
  } catch (error) {
    for (const client of clients) await client.close();
    for (const server of servers) await server.server.close();
    rmSync(dir, {recursive:true, force:true});
    throw error;
  }
}

test('expiry-prefix and ownership failures persist distinct reason codes', async () => {
  const f = await fixture();
  try {
    assert.notEqual(f.refusals[0].reason, f.refusals[1].reason, 'distinct refusal classes must not collapse to hub_guard');
    assert.deepEqual(f.refusals.slice(0,2).map(e => e.reason), ['expiry-prefix', 'ownership']);
  } finally { await f.cleanup(); }
});

test('new reasons are closed enum codes with specific classes and unknown fallback', async () => {
  const f = await fixture();
  try {
    for (const e of f.refusals) assert.ok(CODES.has(e.reason), `unknown reason ${e.reason}`);
    assert.deepEqual(f.refusals.map(e => e.reason), ['expiry-prefix','ownership','auth','key-format','size','state','hub_guard']);
  } finally { await f.cleanup(); }
});

test('fresh Hub replay preserves discriminating tally keys and legacy hub_guard', async () => {
  const f = await fixture();
  try {
    const before = {...f.hub.getRoom('reasons').refusals};
    const replay = new Hub({dataDir:f.dir});
    assert.deepEqual(replay.getRoom('reasons').refusals, before);
    assert.equal(before['board_set: expiry-prefix'], 1);
    assert.equal(before['board_set: ownership'], 1);
    // Historical events remain unknown: never retroactively infer their category.
    appendFileSync(f.path, JSON.stringify({type:'refusal', room:'reasons', tool:'board_set', reason:'hub_guard'}) + '\n');
    const legacyReplay = new Hub({dataDir:f.dir});
    assert.deepEqual(legacyReplay.getRoom('reasons').refusals, {...before, 'board_set: hub_guard':1});
  } finally { await f.cleanup(); }
});

test('persisted reason contains no raw error text, argument values or secrets', async () => {
  const f = await fixture();
  try {
    for (const event of f.refusals) {
      assert.equal(typeof event.reason, 'string');
      assert.ok(CODES.has(event.reason), 'reason must be exactly one enum token, not a message prefix');
      assert.ok(!JSON.stringify(event).includes(SECRET));
      assert.ok(!event.reason.includes('1234567'));
      assert.ok(!event.reason.includes('evidence/owned'));
      assert.deepEqual(Object.keys(event).sort(), ['participant','reason','room','tool','ts','type']);
    }
  } finally { await f.cleanup(); }
});
