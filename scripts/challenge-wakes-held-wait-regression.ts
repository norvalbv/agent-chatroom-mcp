/** Reviewer's probe for b6092d3d (claude-opus-5-5-2, review/b6092d3d), kept as the regression for its fix: a REAL held wait over MCP; the proposer is challenged 1 s in. How long until its wait returns? */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";
(Hub as any).LAST_CALL_MS = 0; Hub.DEFAULT_NUDGE_MS = 0;
const hub = new Hub();
const seat = async (name: string) => {
  const s = createSessionServer(hub); const c = new Client({ name, version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await s.server.connect(st); await c.connect(ct);
  return async (tool: string, args: Record<string, unknown>) => JSON.parse(((await c.callTool({ name: tool, arguments: args })).content as { text: string }[])[0].text) as any;
};
const room = "held";
const A = await seat("a"), B = await seat("b"), C = await seat("c");
for (const [s, n] of [[A, "A"], [B, "B"], [C, "C"]] as const) await s("join_room", { room, name: n, agent: "test" });
const pr = await A("propose", { room, text: "Use --no-cache: the three existing opt-outs are all spelled --no-." });
const id = pr.proposal_id ?? pr.id ?? pr.proposal?.id;
for (const s of [A, B, C]) await s("wait_for_messages", { room, timeout_ms: 0 });
const t0 = Date.now();
const waiting = A("wait_for_messages", { room, timeout_ms: 8000, hold_until_actionable: true });
// meanwhile B chats (not actionable for A), then C challenges A's proposal
await new Promise((r) => setTimeout(r, 400));
await B("send_message", { room, content: "I am reading the flags file now, back in a minute.", force: true, quiet: false });
await new Promise((r) => setTimeout(r, 600));
await C("challenge", { room, proposal_id: id, objection: '"all spelled --no-" is wrong: --claude-full is an opt-out too.' });
const w = await waiting;
const ms = Date.now() - t0;
const sawChallenge = JSON.stringify(w.messages ?? []).includes("claude-full");
console.log(`probe12: held wait returned after ${ms} ms; challenge in the result: ${sawChallenge}`);
assert.ok(sawChallenge && ms < 3000, `the proposer's held wait should return on the challenge (took ${ms} ms)`);
process.exit(0);
