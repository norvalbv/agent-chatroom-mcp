/** Wire-level delta/expiry tests; npx tsx scripts/board-transport-regression.ts */
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Hub } from '../src/hub.js';
import { createSessionServer } from '../src/server.js';
Hub.DEFAULT_NUDGE_MS = 0;
const hub = new Hub();
const session = createSessionServer(hub);
const client = new Client({name:'board-test',version:'1'});
const [ct,st] = InMemoryTransport.createLinkedPair();
await session.server.connect(st); await client.connect(ct);
async function call(name:string,args:Record<string,unknown>) {
 const r = await client.callTool({name,arguments:args});
 assert.ok(!r.isError, JSON.stringify(r));
 return JSON.parse((r.content as {text:string}[])[0].text);
}
try {
 const room='board-wire';
 await call('join_room',{room,name:'A',agent:'test'});
 await call('board_set',{room,key:'evidence/yes',text:'yes'});
 await call('board_set',{room,key:'other/no',text:'no'});
 const first = await call('wait_for_messages',{room,timeout_ms:0,follow:['evidence/']});
 assert.deepEqual(first.board_keys,['evidence/yes'], 'follow must reach hub');
 const empty = await call('wait_for_messages',{room,timeout_ms:0});
 assert.ok(!('board_keys' in empty) && !('board_delta' in empty));
 const pending = call('wait_for_messages',{room,timeout_ms:1000});
 await new Promise(r=>setTimeout(r,20));
 hub.setBoardAs(room,'system','evidence/woke','body');
 assert.deepEqual((await pending).board_delta.keys,['evidence/woke'],'assemble after wake');
 await call('board_set',{room,key:'handoff/old',text:'archive',expires_at:'2000-01-01T00:00:00Z'});
 const archived = await call('board_get',{room,key:'handoff/old'});
 assert.equal(archived.text,'archive'); assert.equal(archived.expired,true); assert.ok(archived.tombstone);
 hub.setBoardAs(room,'system','evidence/after','still unseen');
 const full = await call('board_get',{room});
 assert.ok(!('handoff/old' in full)); assert.ok('other/no' in full);
 const afterFull = await call('wait_for_messages',{room,timeout_ms:0});
 assert.deepEqual(afterFull.board_delta.keys,['evidence/after'],'board_get does not consume wait cursor');
 const stats = hub.stats(hub.getRoom(room)).board_manifests;
 assert.equal(stats?.waits,4); assert.equal(stats?.empty,1);
 const b = hub.join(room,'B','test',{},undefined,'b').participant;
 hub.send(room,b.id,'@A Please examine this change.',undefined,true);
 await call('wait_for_messages',{room,timeout_ms:0}); // establishes address warning
 hub.setBoardAs(room,'system','evidence/refusal','not consumed');
 const beforeCursor = [...hub.getRoom(room).participants.values()].find(p=>p.name==='A')!.lastBoardSeen;
 // A peer's ask leads the wait but no longer strips the envelope (swarm-083203-kooz, 08322c1): the board delta ships
 // with it and the cursor advances, so nothing is re-shipped after the ask is passed.
 const focused = await call('wait_for_messages',{room,timeout_ms:0});
 assert.equal(focused.addressed_to_you?.length,1,JSON.stringify(focused).slice(0,300));
 assert.deepEqual(focused.board_delta?.keys,['evidence/refusal'],'peer-focused envelope ships the board delta');
 assert.notEqual([...hub.getRoom(room).participants.values()].find(p=>p.name==='A')!.lastBoardSeen,beforeCursor);
 await call('pass',{room});
 assert.ok(!('board_delta' in (await call('wait_for_messages',{room,timeout_ms:0}))),'delta shipped once');
 // A human's message still holds the inbox exclusively (humans-answered-once): no board fields, cursor untouched.
 const h = hub.join(room,'human','human',{},undefined,'h').participant;
 hub.send(room,h.id,'@A what is the status of the fix?',undefined,true);
 hub.setBoardAs(room,'system','evidence/held','held behind the human');
 const humanCursor = [...hub.getRoom(room).participants.values()].find(p=>p.name==='A')!.lastBoardSeen;
 const humanFocused = await call('wait_for_messages',{room,timeout_ms:0});
 assert.equal(humanFocused.unanswered_human?.you_answer,true,JSON.stringify(humanFocused).slice(0,300));
 assert.ok(!('board_delta' in humanFocused) && !('board_keys' in humanFocused),'human-focused envelope ships no board fields');
 assert.equal([...hub.getRoom(room).participants.values()].find(p=>p.name==='A')!.lastBoardSeen,humanCursor);
 console.log('BOARD TRANSPORT OK');
} finally {await client.close();await session.server.close();}
