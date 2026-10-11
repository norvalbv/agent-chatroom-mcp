/**
 * A write recruit's workspace is told to the seat that recruits it (swarm-000525-jcz8, ranked-list recruiting rows).
 * The spawner has always given a can_edit recruit its own git worktree and branch, but nothing a seat could see said
 * so: can_edit read "Allow the newcomer to modify files", and the reply's cwd named the shared checkout the recruit
 * does NOT write in. One seat in that room held a build recruit back for an hour, believing it would write into its
 * own worktree, and hand-made one first. Now the schema says it and the reply carries the branch to review.
 * Run: PORT=<free port> npx tsx scripts/recruit-workspace-regression.ts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Spawner } from "../src/spawner.js";

const brief = "Build the parser in src/parser.ts and commit it on your branch.";

// ---------- 1. The spawner records where a write recruit works; a dry run plans it without creating it ----------
const spawner = new Spawner({ mcpUrl: "http://test/mcp", defaultCwd: process.cwd(), logDir: mkdtempSync(join(tmpdir(), "recruit-workspace-")), dryRun: true });
spawner.attach({ isHeld: () => false, claimArea: () => {}, ensureRoom: () => {}, announce: () => {}, liveAgents: () => 0 });
const [w] = spawner.request({ room: "room-a", requestedBy: "seat-1", brief, name: "builder", canEdit: true });
assert.equal(w.workspace?.branch, "swarm/room-a/builder", "a write recruit's branch is swarm/<room>/<name>");
assert.ok(w.workspace?.worktree.endsWith([".swarm-worktrees", "room-a", "builder"].join(sep)), "and its worktree is .swarm-worktrees/<room>/<name>");
const [r] = spawner.request({ room: "room-a", requestedBy: "seat-1", brief, name: "reader" });
assert.equal(r.workspace, undefined, "a read-only recruit has no workspace of its own");
const [n] = spawner.request({ room: "room-a", requestedBy: "seat-1", brief, name: "outside", canEdit: true, cwd: tmpdir() });
assert.equal(n.workspace, undefined, "outside a git repository there is no worktree to promise");

// ---------- 2. Over MCP: the schema says it before the call, and the reply names the branch after it ----------
const PORT = Number(process.env.PORT ?? 7818);
const HTTP = `http://127.0.0.1:${PORT}`;
const server = spawn("npx", ["tsx", "src/index.ts"], { env: { ...process.env, PORT: String(PORT), CHATROOM_SPAWN_DRY: "1", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: mkdtempSync(join(tmpdir(), "recruit-workspace-data-")), CHATROOM_LOG_DIR: mkdtempSync(join(tmpdir(), "recruit-workspace-logs-")) }, stdio: ["ignore", "ignore", "inherit"] });
process.on("exit", () => server.kill());
for (let i = 0; i < 60; i++) {
  try {
    await fetch(`${HTTP}/`);
    break;
  } catch {
    await new Promise((res) => setTimeout(res, 250));
  }
}
const client = new Client({ name: "seat", version: "0.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${HTTP}/mcp`)));
const call = async (tool: string, args: Record<string, unknown>) => {
  const res = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  if (res.isError) throw new Error(res.content[0]?.text);
  return JSON.parse(res.content[0].text);
};
const tool = (await client.listTools()).tools.find((t) => t.name === "request_agent")!;
const canEdit = (tool.inputSchema.properties as Record<string, { description?: string }>).can_edit.description ?? "";
assert.match(canEdit, /own git worktree/, "can_edit says the recruit gets its own worktree, so a seat need not fear a collision");
assert.match(canEdit, /swarm\/<room>\/<name>/, "and names the branch pattern the requester will review");
assert.match(canEdit, /cut from the HEAD of YOUR worktree/, "and says where the branch starts (scripts/recruit-base-regression.ts): the requester's HEAD, so its commits are in it and its uncommitted changes are not");

await call("join_room", { room: "ws-room", name: "seat-1", agent: "claude", topic: "build a parser", expected_participants: 1 });
const built = await call("request_agent", { room: "ws-room", brief, name: "builder", can_edit: true });
assert.deepEqual(built.workspaces.map((x: { name: string; branch: string }) => [x.name, x.branch]), [["builder", "swarm/ws-room/builder"]], "the reply names each write recruit's branch");
assert.ok(built.workspaces[0].worktree.endsWith([".swarm-worktrees", "ws-room", "builder"].join(sep)));
assert.match(built.hint, /branch/, "the hint says where the work will land");
const read = await call("request_agent", { room: "ws-room", brief, name: "reader" });
assert.equal(read.workspaces, undefined, "no workspaces field for a read-only recruit");
const listed = await call("list_agents", { room: "ws-room" });
assert.equal(listed.find((a: { name: string }) => a.name === "builder").branch, "swarm/ws-room/builder", "list_agents shows the branch later, when the reply is long gone from context");

console.log("recruit-workspace-regression OK");
server.kill();
process.exit(0);
