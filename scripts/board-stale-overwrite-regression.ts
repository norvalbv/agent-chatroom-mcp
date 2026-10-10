/**
 * An overwrite of someone else's entry from a stale read is refused, not applied (swarm-082539-kns2, claim/board-cas).
 * ranked/list was one shared document that every seat edited with overwrite=true. claude-opus-5-5-5 read it at ~08:47,
 * claude-opus-5-5-7 rewrote it at 08:49:06, and -5's overwrite at 08:49:26 replaced -7's edit with -5's stale copy;
 * nothing warned either seat, and -7's rows were recovered from the room log by hand. Now the hub remembers which
 * version of an entry it last showed each seat (board_get of the key, a refusal carrying the current text, the seat's
 * own write), and an overwrite of another author's entry the seat has not seen in its current version is refused once,
 * with that version attached, so the retry is a merge. An author editing an entry nobody else changed is untouched.
 * Run: npx tsx scripts/board-stale-overwrite-regression.ts (PORT= to pin)
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = Number(process.env.PORT ?? 20_000 + Math.floor(Math.random() * 20_000));
assert.ok(![7717, 7741, 7742].includes(PORT), "never a live hub");
const HTTP = `http://127.0.0.1:${PORT}`;
const server = spawn("npx", ["tsx", "src/index.ts"], { env: { ...process.env, PORT: String(PORT), CHATROOM_SPAWN_DRY: "1", CHATROOM_LOG_DIR: "/tmp/chatroom-board-cas-spawn", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: "" }, stdio: ["ignore", "ignore", "inherit"] });
process.on("exit", () => server.kill());
for (let i = 0; ; i++) {
  try { await fetch(`${HTTP}/`); break; } catch { if (i > 100) throw new Error("hub did not start"); await new Promise((r) => setTimeout(r, 200)); }
}

const ROOM = "board-cas";
async function seat(name: string, first = false) {
  const client = new Client({ name, version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${HTTP}/mcp`)));
  const call = async (tool: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name: tool, arguments: { room: ROOM, ...args } })) as { isError?: boolean; content: { text: string }[] };
    if (res.isError) throw new Error(res.content[0]?.text);
    try { return JSON.parse(res.content[0]?.text ?? ""); } catch { return res.content[0]?.text; }
  };
  await call("join_room", { name, agent: "claude", ...(first ? { expected_participants: 0 } : {}) });
  return call;
}
const keeper = await seat("keeper", true);
const five = await seat("five");
const seven = await seat("seven");
const text = async (key: string) => ((await (await fetch(`${HTTP}/rooms/${ROOM}`)).json()) as { board: Record<string, { text: string; by: string }> }).board[key];

// 1. The incident: -5 reads, -7 rewrites, -5 overwrites from its stale copy. Refused, with -7's text attached.
await keeper("board_set", { key: "ranked/list", text: "1. a\n2. b" });
await five("board_get", { key: "ranked/list" });
await seven("board_get", { key: "ranked/list" });
await seven("board_set", { key: "ranked/list", text: "1. a\n2. b\n3. seven's row", overwrite: true });
await assert.rejects(five("board_set", { key: "ranked/list", text: "1. a\n2. b\n3. five's row", overwrite: true }), (e: Error) => {
  assert.match(e.message, /changed since you last read it/, e.message);
  assert.match(e.message, /seven's row/, "the refusal carries the current text to merge");
  return true;
});
assert.match((await text("ranked/list")).text, /seven's row/, "-7's edit survives");
// the refusal showed -5 the current version, so the merged retry goes through
await five("board_set", { key: "ranked/list", text: "1. a\n2. b\n3. seven's row\n4. five's row", overwrite: true });
assert.match((await text("ranked/list")).text, /seven's row\n4\. five's row/);

// 2. A seat that never read the entry and overwrites it blind is refused once, then may write.
await assert.rejects(keeper("board_set", { key: "ranked/list", text: "keeper's rewrite", overwrite: true }), /changed since you last read it|have not read/);
await keeper("board_set", { key: "ranked/list", text: "1. a\n2. b\n3. seven's row\n4. five's row\n5. keeper", overwrite: true });

// 3. Untouched: an author editing their own entry; an overwrite of a version the seat has just read.
await five("board_set", { key: "findings/five", text: "v1" });
await five("board_set", { key: "findings/five", text: "v2" });
await seven("board_get", { key: "findings/five" });
await seven("board_set", { key: "findings/five", text: "v2 + seven's note", overwrite: true });
assert.equal((await text("findings/five")).by, "seven");

// 4. Claims keep their own takeover rules (not touched here).
console.log("board-stale-overwrite regression OK");
process.exit(0);
