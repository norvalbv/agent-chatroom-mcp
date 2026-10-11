/** A board write refused for its key says, in the log, what the key looked like (devroom/rehearsal-flat: "a board_set
 * refused for key-format logs no key, so the one key-format refusal here cannot be attributed"; bugs.md telemetry 6:
 * the five rejected digest/<path>@<hash> writes left no countable trace). The shape only, never the text: the log keeps
 * which prefix and which character the rule refused, so no submitted text or secret is
 * kept, but "digest/src/x.ts@ab12" still reads as one. Run: npx tsx scripts/rejected-key-regression.ts */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer, keyShape } from "../src/server.js";

assert.equal(keyShape("digest/src/x.ts@ab12"), "digest/<8>@<4>");
assert.equal(keyShape("notes\nsecret=hunter2"), "<5>?<6>=<7>", "no text of the key survives, only its shape");
assert.equal(keyShape("!SECRET_TOKEN_abc123"), "!<19>");
assert.ok(keyShape("x/" + "a@".repeat(100)).length <= 81, "capped");
assert.equal(keyShape(""), "");

const dir = mkdtempSync(join(tmpdir(), "rejected-key-"));
try {
  const hub = new Hub({ dataDir: dir });
  const s = createSessionServer(hub);
  const c = new Client({ name: "a", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await s.server.connect(st); await c.connect(ct);
  await c.callTool({ name: "join_room", arguments: { room: "rk", name: "a", agent: "test" } });
  const r = (await c.callTool({ name: "board_set", arguments: { room: "rk", key: "digest/src/x.ts@ab12", text: "a summary" } })) as { isError?: boolean };
  assert.equal(r.isError, true);
  await c.callTool({ name: "board_set", arguments: { room: "rk", key: "evidence/ok", text: "fine" } });
  const calls = readFileSync(join(dir, "rk.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.type === "call_completion" && e.tool === "board_set");
  assert.deepEqual(calls.map((e) => [e.outcome, e.key, e.key_rejected]), [["hub_refusal", undefined, "digest/<8>@<4>"], ["success", "evidence/ok", undefined]]);
  await c.close();
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log("rejected-key-regression OK");
