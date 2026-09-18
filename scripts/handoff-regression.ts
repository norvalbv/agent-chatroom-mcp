#!/usr/bin/env node
/** R1 failing-first regression: proactive handoff on context pressure (src/seat.ts).
 * Synthetic provider (scripted tool calls, no external network), throwaway hub on 127.0.0.1.
 * A seat whose provider ALWAYS returns tool calls and never finishes the brief must, BEFORE maxSteps:
 *   - write handoff/<area> on the board for its claim/* (same seat author),
 *   - leave_room with a reason naming the handoff,
 *   - return SeatResult { ok: true, steps < maxSteps, handoffs: ["long-brief"] }.
 * RED on main (seat.ts has no handoff: it runs to the cap and bows bare, claims orphaned);
 * GREEN on the R1 branch. Run: npm run build && node --import tsx scripts/handoff-regression.ts
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, rmSync, existsSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error tsx resolves the .js specifier to src/seat.ts
import { runSeat, type ChatProvider, type Reply, type ToolCall } from "../src/seat.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOM = "handoff-regression";
const SEAT = "handoff-seat";
const CLAIM = "long-brief";
const MAX_STEPS = 12; // handoff step = ceil(12 * 0.75) = 9 < 12: handoff must beat the cap

async function freePort(): Promise<number> {
  const base = 21100 + ((process.pid * 2654435761) % 8000);
  for (let p = base; p < base + 400; p++) {
    const s = createServer();
    try {
      await new Promise<void>((ok, no) => { s.once("error", no); s.listen(p, "127.0.0.1", () => s.close(() => ok())); });
      return p;
    } catch { /* in use, try next */ }
  }
  throw new Error("no free port");
}

const HUB_PORT = await freePort();
const HUB = `http://127.0.0.1:${HUB_PORT}`;
const dataDir = mkdtempSync(join(tmpdir(), "handoff-regression-"));
const hubLog = join(dataDir, "hub.log");
let hub: ChildProcess | undefined;

function startHub(): void {
  assert.ok(existsSync(join(root, "dist", "index.js")), "run `npm run build` first (dist/index.js is the throwaway hub fixture)");
  const fd = openSync(hubLog, "w");
  hub = spawn(process.execPath, [join(root, "dist", "index.js")], {
    env: { ...process.env, PORT: String(HUB_PORT), HOST: "127.0.0.1", CHATROOM_DATA_DIR: dataDir, CHATROOM_SPAWN_DRY: "1", CHATROOM_LOG_DIR: join(dataDir, "spawned") },
    stdio: ["ignore", fd, fd],
  });
}

async function waitReady(): Promise<void> {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (hub!.exitCode !== null) throw new Error(`hub exited ${hub!.exitCode}; log: ${readFileSync(hubLog, "utf8").slice(-1200)}`);
    try { const r = await fetch(`${HUB}/rooms`); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("hub did not become ready");
}

/** Scripted fake provider: join -> claim/long-brief -> endless empty waits. Never finishes the brief. */
function fakeProvider(): ChatProvider {
  let phase: "join" | "claim" | "wait" = "join";
  const reply = (toolCalls: ToolCall[], usage?: Partial<{ prompt_tokens: number; completion_tokens: number }>): Reply => ({ content: "", toolCalls, usage: { prompt_tokens: usage?.prompt_tokens ?? 100, completion_tokens: usage?.completion_tokens ?? 10 } as { prompt_tokens?: number; completion_tokens?: number } });
  return {
    label: "fake provider",
    async complete(): Promise<Reply> {
      if (phase === "join") {
        phase = "claim";
        return reply([{ id: "c1", type: "function", function: { name: "join_room", arguments: JSON.stringify({ room: ROOM, name: SEAT, agent: "openrouter" }) } }]);
      }
      if (phase === "claim") {
        phase = "wait";
        const claim = JSON.stringify({ area: CLAIM, owner: SEAT, team: [SEAT], status: "open", note: "failing-first fixture claim" });
        return reply([{ id: "c2", type: "function", function: { name: "board_set", arguments: JSON.stringify({ room: ROOM, key: `claim/${CLAIM}`, text: claim }) } }]);
      }
      return reply([{ id: "c3", type: "function", function: { name: "wait_for_messages", arguments: JSON.stringify({ room: ROOM, timeout_ms: 40 }) } }]);
    },
  };
}

try {
  startHub();
  await waitReady();

  const result = await runSeat(fakeProvider(), {
    prompt: `You are ${SEAT} in room ${ROOM}. Join the room and claim ${CLAIM}. The brief is very long and cannot be finished; stay and keep waiting.`,
    mcpUrl: `${HUB}/mcp`,
    cwd: dataDir,
    maxMinutes: 2,
    maxSteps: MAX_STEPS,
    maxToolChars: 4000,
    maxContextChars: 40000,
    idleWaits: 1,
    log: () => {},
  });

  // --- assertions: the proactive handoff contract ---
  assert.equal(result.ok, true, `seat must terminate cleanly, got ok=${result.ok} final=${result.final}`);
  assert.ok(result.steps < MAX_STEPS, `seat must hand off BEFORE maxSteps=${MAX_STEPS}, but exited after step ${result.steps}`);
  const handoffs = (result as { handoffs?: string[] }).handoffs ?? [];
  assert.ok(handoffs.includes(CLAIM), `SeatResult must report handed-off area "${CLAIM}", got ${JSON.stringify(handoffs)}`);

  const logPath = join(dataDir, `${ROOM}.jsonl`);
  assert.ok(existsSync(logPath), `hub must persist room log at ${logPath}`);
  const events = readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const board = events.filter((e: any) => e.type === "board" && e.key);
  const handoffEvs = board.filter((e: any) => e.key === `handoff/${CLAIM}`);
  assert.ok(handoffEvs.length > 0, "no handoff/<area> board event by the seat in the room log");
  assert.ok(handoffEvs.every((e: any) => e.entry?.by === SEAT), "handoff/* must be authored by the leaving seat");
  const claimEvs = board.filter((e: any) => e.key === `claim/${CLAIM}`);
  assert.ok(claimEvs.length > 0, "fixture claim was never written");
  const claimIdx = events.indexOf(claimEvs.at(-1));
  const handoffIdx = events.indexOf(handoffEvs.at(-1));
  assert.ok(handoffIdx > claimIdx, "handoff/* must be written after the claim exists");
  const leaves = events.filter((e: any) => e.type === "leave");
  assert.ok(leaves.length > 0, "no leave_room event in the room log");
  const reasons = leaves.map((e: any) => e.p?.leaveReason ?? "").join(" | ");
  assert.match(reasons, /handoff/i, `leave_room reason must name the handoff, got: ${reasons}`);
  const leaveIdx = events.indexOf(leaves.at(-1));
  assert.ok(leaveIdx > handoffIdx, "leave_room must come after handoff/* is written");

  console.log(`PASS handoff-regression: steps=${result.steps}/${MAX_STEPS} handoffs=${JSON.stringify(handoffs)} ok=${result.ok}`);
} finally {
  if (hub && hub.exitCode === null && hub.signalCode === null) hub.kill();
  await new Promise((r) => setTimeout(r, 300));
  rmSync(dataDir, { recursive: true, force: true });
}
