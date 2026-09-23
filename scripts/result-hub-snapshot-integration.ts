/**
 * Integration: a REAL throwaway hub serves full room payloads; collectRoomSnapshot must retain
 * board bodies, proposals and challenges byte-for-byte, and the artifact must survive the hub.
 */
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const { collectRoomSnapshot, writeRunResult, readRunResult } = await import("../src/result.js");

const PORT = Number(process.env.INTEGRATION_PORT ?? 8321);
const HTTP = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(resolve(tmpdir(), "result-hub-int-"));
const server = spawn("npx", ["tsx", "src/index.ts"], { env: { ...process.env, PORT: String(PORT), CHATROOM_DATA_DIR: dataDir }, stdio: ["ignore", "ignore", "inherit"] });
process.on("exit", () => server.kill());
for (let i = 0; i < 50; i++) { try { await fetch(`${HTTP}/`); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }

const connect = async (name: string) => {
  const client = new Client({ name, version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${HTTP}/mcp`)));
  const call = async (tool: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    const text = res.content[0]?.text ?? "";
    if (res.isError) throw new Error(`${name}.${tool}: ${text}`);
    try { return JSON.parse(text); } catch { return text; }
  };
  return { client, call };
};
try {
  const a = await connect("producer-a");
  const b = await connect("producer-b");
  await a.call("join_room", { room: "snap", name: "a", agent: "claude", topic: "snapshot integration", expected_participants: 2 });
  await b.call("join_room", { room: "snap", name: "b", agent: "codex", topic: "snapshot integration", expected_participants: 2 });
  const body = "BODY-START\n\n## nested heading inside evidence\n\n" + "e".repeat(7500) + "\n\nBODY-END";
  await a.call("board_set", { room: "snap", key: "evidence/large", text: body });
  await a.call("propose", { room: "snap", text: "Adopt exact transport with\n\n## embedded heading\n\nand trailing whitespace  " });
  await b.call("challenge", { room: "snap", proposal_id: (await a.call("room_status", { room: "snap" })).proposals.at(-1).id, objection: 'The clause "Adopt exact transport with" is untested: challenge text retained verbatim' });

  const snapshot = await collectRoomSnapshot(HTTP, "snap");
  assert.equal(snapshot.error, null);
  assert.ok(snapshot.payload, "snapshot carries a payload");
  assert.equal(snapshot.payload.board["evidence/large"].text, body, "board body must survive the real hub GET");
  assert.match(String(snapshot.payload.proposals[0].text), /## embedded heading/);
  assert.equal(snapshot.payload.proposals[0].challenges[0].objection, 'The clause "Adopt exact transport with" is untested: challenge text retained verbatim');

  const artifact = { schemaVersion: 1 as const, run: { id: "swarm-int", startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:01:00Z", task: "t", doneWhen: "d" }, project: { cwd: dataDir, canonicalPath: dataDir, git: null }, leadRoom: "snap", rooms: [snapshot], verifier: { name: "verifier" as const, output: null }, reportPath: resolve(dataDir, "report.md"), artifactPath: resolve(dataDir, "result.json") };
  writeRunResult(artifact.artifactPath, artifact);
  server.kill();
  await new Promise<void>((done) => server.on("close", () => done()));
  const offline = readRunResult(artifact.artifactPath); // hub is down here
  assert.equal(offline.rooms[0].payload!.board["evidence/large"].text, body);
  console.log("REAL HUB SNAPSHOT INTEGRATION OK");
} finally { server.kill(); rmSync(dataDir, { recursive: true, force: true }); }
