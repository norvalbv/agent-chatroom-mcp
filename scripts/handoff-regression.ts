#!/usr/bin/env node
/** R1/R2 failing-first regression: proactive handoff on context pressure and on an idle run (src/seat.ts).
 * Synthetic provider (scripted tool calls, no external network), throwaway hub on 127.0.0.1.
 * A seat whose provider ALWAYS returns tool calls and never finishes the brief must, BEFORE maxSteps:
 *   - write handoff/<area> on the board for its claim/* (same seat author),
 *   - leave_room with a reason naming the handoff,
 *   - return SeatResult { ok: true, steps < maxSteps, handoffs: ["long-brief"] }.
 * Scenario C additionally proves a fourth trigger (R2, swarm-084605-6m31): handoffIdleTurns consecutive
 * turns with no actionable hub hint and no outbound send_message/board_set, with steps/tokens/context all
 * held far out of reach so only the idle-run count can explain the handoff.
 * RED on main (seat.ts has no handoff: it runs to the cap and bows bare, claims orphaned);
 * GREEN on the R1+R2 branch. Run: npm run build && node --import tsx scripts/handoff-regression.ts
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

/** Scripted fake provider: join -> claim/<area> -> endless empty waits. Never finishes the brief. */
function fakeProvider(room: string, area: string): ChatProvider {
  let phase: "join" | "claim" | "wait" = "join";
  const reply = (toolCalls: ToolCall[]): Reply => ({ content: "", toolCalls, usage: { prompt_tokens: 100, completion_tokens: 10 } as { prompt_tokens?: number; completion_tokens?: number } });
  return {
    label: "fake provider",
    async complete(): Promise<Reply> {
      if (phase === "join") {
        phase = "claim";
        return reply([{ id: "c1", type: "function", function: { name: "join_room", arguments: JSON.stringify({ room, name: SEAT, agent: "openrouter" }) } }]);
      }
      if (phase === "claim") {
        phase = "wait";
        const claim = JSON.stringify({ area, owner: SEAT, team: [SEAT], status: "open", note: "failing-first fixture claim" });
        return reply([{ id: "c2", type: "function", function: { name: "board_set", arguments: JSON.stringify({ room, key: `claim/${area}`, text: claim }) } }]);
      }
      return reply([{ id: "c3", type: "function", function: { name: "wait_for_messages", arguments: JSON.stringify({ room, timeout_ms: 40 }) } }]);
    },
  };
}

/** Scripted fake provider: join -> claim/<area> -> endless LOCAL tool calls (never send_message/board_set,
 * never a hub call that could carry an actionable hint). Isolates the idle-run trigger from the
 * steps/tokens/context-fraction ones: this seat never approaches any of those, only the idle-turn count. */
function fakeIdleProvider(room: string, area: string): ChatProvider {
  let phase: "join" | "claim" | "idle" = "join";
  const reply = (toolCalls: ToolCall[]): Reply => ({ content: "", toolCalls, usage: { prompt_tokens: 5, completion_tokens: 2 } as { prompt_tokens?: number; completion_tokens?: number } });
  return {
    label: "fake idle provider",
    async complete(): Promise<Reply> {
      if (phase === "join") {
        phase = "claim";
        return reply([{ id: "c1", type: "function", function: { name: "join_room", arguments: JSON.stringify({ room, name: SEAT, agent: "openrouter" }) } }]);
      }
      if (phase === "claim") {
        phase = "idle";
        const claim = JSON.stringify({ area, owner: SEAT, team: [SEAT], status: "open", note: "idle-run fixture claim" });
        return reply([{ id: "c2", type: "function", function: { name: "board_set", arguments: JSON.stringify({ room, key: `claim/${area}`, text: claim }) } }]);
      }
      // a purely local tool: never touches the hub, so it can neither carry a hint nor count as outbound room work
      return reply([{ id: "c-idle", type: "function", function: { name: "list_dir", arguments: JSON.stringify({ path: "." }) } }]);
    },
  };
}

/** Full contract check for one scenario: handoff board event after the claim, leave reason naming it, ok+steps+handoffs on the result. */
async function runCase(name: string, area: string, maxSteps: number, expectHandoffAt: number, extra: Partial<import("../src/seat.js").SeatOptions> = {}) {
  const result = await runSeat(fakeProvider(name, area), {
    prompt: `You are ${SEAT} in room ${name}. Join the room and claim ${area}. The brief is very long and cannot be finished; stay and keep waiting.`,
    mcpUrl: `${HUB}/mcp`,
    cwd: dataDir,
    maxMinutes: 2,
    maxSteps,
    maxToolChars: 4000,
    maxContextChars: 40000,
    idleWaits: 1,
    log: () => {},
    ...extra,
  });
  assert.equal(result.ok, true, `[${name}] seat must terminate cleanly, got ok=${result.ok} final=${result.final}`);
  assert.ok(result.steps < maxSteps, `[${name}] seat must hand off BEFORE maxSteps=${maxSteps}, but exited after step ${result.steps}`);
  assert.ok(result.steps <= expectHandoffAt, `[${name}] seat must hand off by step ${expectHandoffAt}, exited at ${result.steps}`);
  const handoffs = (result as { handoffs?: string[] }).handoffs ?? [];
  assert.ok(handoffs.includes(area), `[${name}] SeatResult must report handed-off area "${area}", got ${JSON.stringify(handoffs)}`);

  const logPath = join(dataDir, `${name}.jsonl`);
  assert.ok(existsSync(logPath), `[${name}] hub must persist room log at ${logPath}`);
  const events = readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const board = events.filter((e: any) => e.type === "board" && e.key);
  const handoffEvs = board.filter((e: any) => e.key === `handoff/${area}`);
  assert.ok(handoffEvs.length > 0, `[${name}] no handoff/<area> board event in the room log`);
  assert.ok(handoffEvs.every((e: any) => e.entry?.by === SEAT, `[${name}] handoff/* must be authored by the leaving seat`));
  const claimEvs = board.filter((e: any) => e.key === `claim/${area}`);
  assert.ok(claimEvs.length > 0, `[${name}] fixture claim was never written`);
  assert.ok(events.indexOf(handoffEvs.at(-1)) > events.indexOf(claimEvs.at(-1)), `[${name}] handoff/* must be written after the claim exists`);
  const leaves = events.filter((e: any) => e.type === "leave");
  assert.ok(leaves.length > 0, `[${name}] no leave_room event in the room log`);
  const reasons = leaves.map((e: any) => e.p?.leaveReason ?? "").join(" | ");
  assert.match(reasons, /handoff/i, `[${name}] leave_room reason must name the handoff, got: ${reasons}`);
  assert.ok(events.indexOf(leaves.at(-1)) > events.indexOf(handoffEvs.at(-1)), `[${name}] leave_room must come after handoff/* is written`);
  console.log(`PASS ${name}: steps=${result.steps}/${maxSteps} handoffs=${JSON.stringify(handoffs)} ok=${result.ok}`);
}

/** C) idle-run trigger: a seat that keeps making tool calls but produces no actionable hub hint and no
 * outbound send_message/board_set must hand off after handoffIdleTurns consecutive such turns, distinct
 * from the steps/tokens/context-fraction triggers (maxSteps/tokens/context are all set far out of reach
 * here, so only the idle-run count can explain the handoff). */
async function runIdleCase(name: string, area: string, handoffIdleTurns: number) {
  const maxSteps = 200; // step-fraction (0.75 default) would fire at step 150: far later than the idle trigger
  // join(step 1, actionable hint) + claim(step 2, outbound write) both reset the streak; the idle
  // phase starts at step 3 and the check at the top of step (3 + handoffIdleTurns) is the first to see
  // idleRunStreak >= handoffIdleTurns, so that is exactly when the seat hands off (no model turn that step).
  const expectHandoffAt = 3 + handoffIdleTurns;
  const result = await runSeat(fakeIdleProvider(name, area), {
    prompt: `You are ${SEAT} in room ${name}. Join the room, claim ${area}, then do unrelated local work forever.`,
    mcpUrl: `${HUB}/mcp`,
    cwd: dataDir,
    maxMinutes: 2,
    maxSteps,
    maxToolChars: 4000,
    maxContextChars: 200_000, // far above what handoffIdleTurns local-tool turns can reach
    idleWaits: 1,
    handoffIdleTurns,
    log: () => {},
  });
  assert.equal(result.ok, true, `[${name}] seat must terminate cleanly, got ok=${result.ok} final=${result.final}`);
  assert.ok(result.steps < maxSteps, `[${name}] seat must hand off BEFORE maxSteps=${maxSteps}, but exited after step ${result.steps}`);
  assert.equal(result.steps, expectHandoffAt, `[${name}] seat must hand off exactly at step ${expectHandoffAt} (2 setup steps + ${handoffIdleTurns} idle turns + 1), exited at ${result.steps}`);
  const handoffs = (result as { handoffs?: string[] }).handoffs ?? [];
  assert.ok(handoffs.includes(area), `[${name}] SeatResult must report handed-off area "${area}", got ${JSON.stringify(handoffs)}`);

  const logPath = join(dataDir, `${name}.jsonl`);
  assert.ok(existsSync(logPath), `[${name}] hub must persist room log at ${logPath}`);
  const events = readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const board = events.filter((e: any) => e.type === "board" && e.key);
  const handoffEvs = board.filter((e: any) => e.key === `handoff/${area}`);
  assert.ok(handoffEvs.length > 0, `[${name}] no handoff/<area> board event in the room log`);
  const leaves = events.filter((e: any) => e.type === "leave");
  assert.ok(leaves.length > 0, `[${name}] no leave_room event in the room log`);
  const reasons = leaves.map((e: any) => e.p?.leaveReason ?? "").join(" | ");
  assert.match(reasons, /handoff/i, `[${name}] leave_room reason must name the handoff, got: ${reasons}`);
  // the one assertion that separates this scenario from A/B: the reason must name the idle-run cause specifically
  assert.match(reasons, /idle run/i, `[${name}] leave_room reason must name the idle-run cause specifically (not steps/tokens/context), got: ${reasons}`);
  console.log(`PASS ${name}: steps=${result.steps} handoffs=${JSON.stringify(handoffs)} ok=${result.ok}`);
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

  // --- assertions (two scenarios, one hub) ---
  // A) default fraction path: ceil(0.75 * 12) = 9 -> hand off at step 9, before the cap
  await runCase(ROOM, CLAIM, MAX_STEPS, 9);
  // B) lobby test spec (draft/r1-test-and-measure): --handoff-step-max 8 with maxSteps=600
  await runCase("handoff-regression-b", "alpha", 600, 8, { handoffStepMax: 8 });
  // C) idle-run trigger (R2): 4 consecutive turns with no actionable hint and no outbound write
  await runIdleCase("handoff-regression-c", "beta", 4);
} finally {
  if (hub && hub.exitCode === null && hub.signalCode === null) hub.kill();
  await new Promise((r) => setTimeout(r, 300));
  rmSync(dataDir, { recursive: true, force: true });
}
