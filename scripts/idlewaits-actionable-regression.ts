/**
 * Item 1 (rank 1, swarm-082729-8b5j-room prop_a7a385ba): src/seat.ts's free local repoll loop for
 * wait_for_messages must break only on `actionable(v)`, not on `(v.messages?.length ?? 0) > 0`. Any
 * unread message today forces a full model turn even when it is irrelevant room chatter, defeating
 * idleWaits exactly when a busy room needs it most.
 *
 * This drives a REAL hub (subprocess) and a REAL runSeat over MCP, with a fake ChatProvider so no
 * network/provider credit is spent. A "prober" participant floods the room with plain chatter while
 * the seat is inside a single wait_for_messages tool call, then sends one @-mention. Assertions:
 *   1. Chatter is never exposed to the model more than once (it is absorbed by the local repoll, not
 *      surfaced turn-by-turn) — the regression signal for the bug.
 *   2. Total provider.complete() calls stays small regardless of chatter volume.
 *   3. The @-mention is still delivered and answered promptly (fix must not cost delivery guarantees).
 *
 * Run: npx tsx scripts/idlewaits-actionable-regression.ts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { runSeat, type ChatProvider, type Msg, type Reply } from "../src/seat.js";

const PORT = Number(process.env.IDLEWAITS_PORT ?? 8842);
const HTTP = `http://127.0.0.1:${PORT}`;
const ROOM = "idlewaits-test";
const SEAT_NAME = "seat-under-test";
const CHATTER_COUNT = 6;
const CHATTER_MARK = /chatter-\d+/;

const dataDir = mkdtempSync(resolve(tmpdir(), "idlewaits-regression-"));
const server = spawn("npx", ["tsx", "src/index.ts"], {
  env: { ...process.env, PORT: String(PORT), CHATROOM_DATA_DIR: dataDir, CHATROOM_SPAWN_DRY: "1" },
  stdio: ["ignore", "ignore", "inherit"],
});
let exiting = false;
process.on("exit", () => {
  if (exiting) return;
  exiting = true;
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
});

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${HTTP}/`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("server did not start");
}

async function connectProber(name: string) {
  const client = new Client({ name, version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${HTTP}/mcp`)));
  const call = async (tool: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    const text = res.content[0]?.text ?? "";
    if (res.isError) throw new Error(`${name}.${tool}: ${text}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
  return { client, call };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

await waitForServer();
const prober = await connectProber("prober");
// prober joins first so the room exists with no openings gate (expected_participants omitted)
await prober.call("join_room", { room: ROOM, name: "prober", agent: "test", topic: "idlewaits regression" });

let completeCalls = 0;
let chatterExposures = 0;
let phase: "join" | "wait" | "respond" | "leave" | "done" = "join";
type ToolMsg = Extract<Msg, { role: "tool" }>;
const lastToolResult = (messages: Msg[]): unknown => {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "tool") {
      try {
        return JSON.parse((messages[i] as ToolMsg).content);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
};

const fakeProvider: ChatProvider = {
  label: "fake-idlewaits-test",
  async complete(messages: Msg[]): Promise<Reply> {
    completeCalls++;
    const view = lastToolResult(messages) as { hint?: string; messages?: { content?: string }[] } | undefined;
    if (view?.messages?.some((m) => CHATTER_MARK.test(m.content ?? "")) && !/addressed you directly/.test(view.hint ?? "")) chatterExposures++;
    const call = (name: string, args: Record<string, unknown>) => ({
      content: "",
      toolCalls: [{ id: `c${completeCalls}`, type: "function" as const, function: { name, arguments: JSON.stringify(args) } }],
    });
    if (phase === "join") {
      phase = "wait";
      return call("join_room", { room: ROOM, name: SEAT_NAME, agent: "test" });
    }
    if (phase === "wait") {
      const idMatch = /reply_to="([^"]+)"/.exec(view?.hint ?? "");
      if (idMatch && /addressed you directly/.test(view?.hint ?? "")) {
        phase = "respond";
        return call("send_message", { room: ROOM, content: "ack", reply_to: idMatch[1] });
      }
      return call("wait_for_messages", { room: ROOM, timeout_ms: 1200 });
    }
    if (phase === "respond") {
      phase = "leave";
      return call("leave_room", { room: ROOM, reason: "idlewaits regression test done" });
    }
    phase = "done";
    return { content: "done", toolCalls: [] };
  },
};

const seatPromise = runSeat(fakeProvider, {
  prompt: "You are a test seat. Follow hub hints exactly.",
  mcpUrl: `${HTTP}/mcp`,
  cwd: resolve("."),
  write: false,
  shell: false,
  maxMinutes: 1,
  maxSteps: 30,
  idleWaits: 8,
  log: () => {},
});

// Let join_room + the first wait_for_messages call start, then flood chatter while the seat idles.
await sleep(500);
for (let i = 0; i < CHATTER_COUNT; i++) {
  await prober.call("send_message", { room: ROOM, content: `chatter-${i} nothing to see here` });
  await sleep(250);
}
await sleep(300);
await prober.call("send_message", { room: ROOM, content: `@${SEAT_NAME} ping` });

let timer: ReturnType<typeof setTimeout>;
const timeout = new Promise((_, reject) => {
  timer = setTimeout(() => reject(new Error("runSeat did not finish in time (likely the idlewaits fix is missing or broken)")), 25_000);
});
try {
  const result = await Promise.race([seatPromise, timeout]);
  assert.equal((result as { ok: boolean }).ok, true, "seat run must end cleanly");
  assert.equal(chatterExposures <= 1, true, `chatter must be absorbed locally, not surfaced repeatedly to the model (saw ${chatterExposures} exposures)`);
  assert.equal(completeCalls <= 5, true, `expected <=5 model turns (join, wait, reply, leave, +1 slack); got ${completeCalls} — each chatter message is costing its own model turn`);
  console.log(`IDLEWAITS ACTIONABLE-ONLY BREAK: OK (completeCalls=${completeCalls}, chatterExposures=${chatterExposures})`);
  process.exitCode = 0;
} finally {
  clearTimeout(timer!);
  // the prober's own MCP session must be torn down explicitly: an open StreamableHTTP client keeps
  // the process alive and the `exit` handler (which kills the hub subprocess) would never fire.
  await (prober.client.transport as { terminateSession?: () => Promise<void> } | undefined)?.terminateSession?.().catch(() => {});
  await prober.client.close().catch(() => {});
  server.kill();
}
