/**
 * The vote tool says an agree can end the room (evidence-pack item 1; the owner: "Sometimes the agents don't understand
 * what voting and the consensus is"). In the records seats agreed to text they meant to keep editing: 0btz-build
 * proposed with rows "[..]" ("then we amend the remaining rows in before 17:09") and concluded 38 s later; 0btz-break
 * concluded 6 s after a seat said its rerun was still running. The propose description now says adoption ends the
 * room (6cfe8ad9); the vote description, where the deciding act happens, said nothing. Settled axis
 * minimal-prompt-hub-carries-coordination: the tools explain themselves, so the sentence goes in the tool, not a prompt.
 * Red on main: no such sentence. Run: npx tsx scripts/vote-text-says-it-ends-regression.ts
 */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";

const session = createSessionServer(new Hub());
const client = new Client({ name: "t", version: "1" });
const [ct, st] = InMemoryTransport.createLinkedPair();
await session.server.connect(st); await client.connect(ct);
const tools = (await client.listTools()).tools;
const vote = tools.find((t) => t.name === "vote")!.description ?? "";
assert.match(vote, /agree can be the one that concludes the room/i, "the vote tool says an agree may end the room");
assert.match(vote, /as it stands/, "and to agree only to the text as it stands");
assert.ok(vote.length < 800, `and stays short (${vote.length} chars): every seat pays for it on every turn`);
console.log("vote-text-says-it-ends-regression OK");
process.exit(0);
