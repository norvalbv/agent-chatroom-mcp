/**
 * Pool item 8 (swarm-105804): a claim/* entry carries the claimant's branch and worktree, filled in by the hub from the
 * seat (the launcher-written MCP URL), never typed by it, so a reviewer can read work in progress without asking.
 * Throwaway hub on its own port (never 7717), stopped on exit.
 * Run: npx tsx scripts/claim-workspace-regression.ts
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { seatBeat } from "../src/env.js";
import { Hub } from "../src/hub.js";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "claim-workspace-")));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const repo = (name: string, branch: string) => {
  const dir = join(scratch, name);
  const r = spawnSync("git", ["init", "-q", "-b", branch, dir], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return dir;
};
const wtA = repo("seat-a", "swarm/run/seat-a");

// 1. seatBeat puts the seat's worktree on its MCP URL next to its key.
const url = new URL(seatBeat("http://127.0.0.1:1/mcp", "k", wtA).mcpUrl);
assert.equal(url.searchParams.get("seat"), "k");
assert.equal(url.searchParams.get("worktree"), wtA);
assert.equal(new URL(seatBeat("http://127.0.0.1:1/mcp", "k").mcpUrl).searchParams.has("worktree"), false, "no worktree, no param");

// 2. Hub: a claim by a bound seat carries {branch, worktree}; the branch is read from git, not typed.
{
  const hub = new Hub();
  const { participant: a } = hub.join("cw", "seat-a", "claude", {}, undefined, "sess-a");
  const { participant: b } = hub.join("cw", "seat-b", "claude", {}, undefined, "sess-b");
  hub.bindSeat("key-a", "sess-a", wtA);
  const claim = JSON.stringify({ area: "x", owner: "seat-a", team: ["seat-a"], status: "open", note: "n" });
  const e = hub.setBoard("cw", a.id, "claim/x", claim)!;
  assert.deepEqual(e.workspace, { branch: "swarm/run/seat-a", worktree: wtA });
  const notice = hub.getRoom("cw").messages.filter((m) => m.kind === "board").at(-1)!;
  assert.match(notice.content, /branch swarm\/run\/seat-a/, "the claim notice names the branch");
  // The branch is read at each write: a seat that switched branches shows the new one.
  assert.equal(spawnSync("git", ["-C", wtA, "checkout", "-q", "-b", "swarm/run/seat-a-2"]).status, 0);
  assert.equal(hub.setBoard("cw", a.id, "claim/x", claim)!.workspace?.branch, "swarm/run/seat-a-2");
  // A seat with no bound worktree gets no workspace, whatever its text says.
  const forged = JSON.stringify({ area: "y", owner: "seat-b", team: ["seat-b"], status: "open", workspace: { branch: "main", worktree: "/" } });
  assert.equal(hub.setBoard("cw", b.id, "claim/y", forged)!.workspace, undefined, "the hub never takes the workspace from the text");
  // Only claim/* entries carry it.
  assert.equal(hub.setBoard("cw", a.id, "evidence/a", "notes")!.workspace, undefined);
}

// 3. End to end: the MCP URL the launcher writes is how the hub learns it; board_get shows it.
const PORT = Number(process.env.PORT ?? 20_000 + Math.floor(Math.random() * 20_000));
assert.notEqual(PORT, 7717, "never the live hub");
const HTTP = `http://127.0.0.1:${PORT}`;
const server = spawn("npx", ["tsx", "src/index.ts"], { env: { ...process.env, PORT: String(PORT), CHATROOM_SPAWN_DRY: "1", CHATROOM_LOG_DIR: join(scratch, "spawn"), CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: "" }, stdio: ["ignore", "ignore", "inherit"] });
process.on("exit", () => server.kill());
for (let i = 0; ; i++) {
  try { await fetch(`${HTTP}/`); break; } catch { if (i > 150) throw new Error("hub did not start"); await new Promise((r) => setTimeout(r, 200)); }
}
const wtC = repo("seat-c", "swarm/run/seat-c");
const client = new Client({ name: "cw", version: "0.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(seatBeat(`${HTTP}/mcp`, "key-c", wtC).mcpUrl)));
const call = async (tool: string, args: Record<string, unknown>) => {
  const res = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  if (res.isError) throw new Error(`${tool}: ${res.content[0]?.text}`);
  return JSON.parse(res.content[0]!.text);
};
await call("join_room", { room: "cw-e2e", name: "seat-c", agent: "claude", expected_participants: 0 });
await call("board_set", { room: "cw-e2e", key: "claim/z", text: JSON.stringify({ area: "z", owner: "seat-c", team: ["seat-c"], status: "open" }) });
const got = await call("board_get", { room: "cw-e2e", key: "claim/z" });
assert.deepEqual(got.workspace, { branch: "swarm/run/seat-c", worktree: wtC });
const manifest = await call("board_get", { room: "cw-e2e" });
assert.equal(manifest["claim/z"].branch, "swarm/run/seat-c", "the manifest names the branch too");
await client.close();
console.log("CLAIM WORKSPACE OK");
process.exit(0);
