#!/usr/bin/env node
/**
 * Item 6 (Rank 3, prop_a7a385ba) failing-first regression: cache-stable trimming (src/seat.ts trim()).
 * Purely local (no hub, no network): a synthetic provider drives runSeat with local-only tools so the
 * transcript grows deterministically every step, forcing trim() to fire repeatedly once maxContextChars
 * is hit.
 *
 * Property under test: cache-prefix-stability. For a provider prompt cache to survive between two
 * consecutive requests, request K's serialized messages[] must be a byte-for-byte PREFIX of request
 * K+1's. Legacy trim() (checkpointTrim off) refires on roughly every other step once a seat rides the
 * ceiling, splicing the middle of the transcript almost every turn — RED: most consecutive step pairs
 * are not prefix-stable. checkpointTrim (on) drops to a lower floor in one shot, so trimming becomes an
 * infrequent checkpoint and the transcript is append-only (hence prefix-stable) between firings — GREEN.
 *
 * Run: npx tsx scripts/trim-checkpoint-regression.ts
 */
import assert from "node:assert/strict";
// @ts-expect-error tsx resolves the .js specifier to src/seat.ts
import { runSeat, type ChatProvider, type Msg, type Reply, type ToolCall, type ToolDef } from "../src/seat.js";

const MAX_CONTEXT_CHARS = 6_000; // small ceiling: forces several trims quickly, keeping the test fast
const MAX_STEPS = 80; // comfortably enough steps to see 2+ trims under either mode
const PAD = "x".repeat(400); // deterministic per-step growth; the exact bytes do not matter, only that each step appends something new

/** Always issues one cheap local tool call and pads its own content so the transcript grows every step. */
function growingProvider(): ChatProvider {
  let step = 0;
  return {
    label: "synthetic-growing-provider",
    async complete(_messages: Msg[], _tools: ToolDef[]): Promise<Reply> {
      step++;
      return {
        content: `step ${step} note: ${PAD}`,
        toolCalls: [{ id: `c${step}`, type: "function", function: { name: "run_command", arguments: JSON.stringify({ command: "echo ok" }) } }] as ToolCall[],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      };
    },
  };
}

/**
 * Runs the seat with a wrapped provider that snapshots every request's messages[], one JSON string per
 * message (NOT one JSON string for the whole array: `JSON.stringify(arr)` is never a byte-prefix of
 * `JSON.stringify(longerArr)` because the shorter array's closing `]` lands exactly where the longer one
 * continues with `,nextElement]` — that mismatch is an artifact of array serialization, not something a
 * provider's prompt cache (which reuses a shared prefix of message objects/content blocks) cares about).
 */
async function captureRequests(checkpointTrim: boolean | undefined): Promise<string[][]> {
  const inner = growingProvider();
  const captured: string[][] = [];
  const spy: ChatProvider = {
    label: inner.label,
    async complete(messages, tools) {
      captured.push(messages.map((m) => JSON.stringify(m)));
      return inner.complete(messages, tools);
    },
  };
  await runSeat(spy, {
    prompt: "Synthetic trim-checkpoint fixture: no hub, local tools only.",
    cwd: process.cwd(),
    write: false,
    shell: true,
    maxMinutes: 5,
    maxSteps: MAX_STEPS,
    maxToolChars: 2000,
    maxContextChars: MAX_CONTEXT_CHARS,
    idleWaits: 1,
    checkpointTrim,
    log: () => {},
  });
  return captured;
}

/** request K is a prefix of request K+1 when every one of K's per-message strings appears, in order, unchanged, at the start of K+1. */
function isMessagePrefix(a: string[], b: string[]): boolean {
  if (b.length <= a.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function prefixStablePairs(captured: string[][]): { stable: number; unstable: number; firstUnstableAt: number | null } {
  let stable = 0, unstable = 0, firstUnstableAt: number | null = null;
  for (let i = 0; i < captured.length - 1; i++) {
    if (isMessagePrefix(captured[i], captured[i + 1])) stable++;
    else {
      unstable++;
      if (firstUnstableAt === null) firstUnstableAt = i;
    }
  }
  return { stable, unstable, firstUnstableAt };
}

let failures = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL ${name}: ${(e as Error).message}`);
  }
}

let legacyCaptured: string[][] = [];
let checkpointCaptured: string[][] = [];

await test("fixture actually forces multiple trims under both modes (sanity, not the property under test)", async () => {
  legacyCaptured = await captureRequests(false);
  checkpointCaptured = await captureRequests(true);
  assert.ok(legacyCaptured.length >= 30, `expected >=30 requests, got ${legacyCaptured.length}`);
  assert.ok(checkpointCaptured.length >= 30, `expected >=30 requests, got ${checkpointCaptured.length}`);
});

await test("legacy trim (checkpointTrim off) is NOT cache-prefix-stable: most consecutive requests diverge", async () => {
  const { stable, unstable } = prefixStablePairs(legacyCaptured);
  // The whole point of Rank 3: legacy FIFO trim edits the transcript's middle on ~half the steps once it
  // rides the ceiling, so unstable pairs dominate once trimming kicks in. Guard the baseline so this test
  // would have failed the checkpointTrim assertion below if run against unpatched main.
  assert.ok(unstable > stable, `expected legacy trim to break the prefix on more pairs than it preserves, got stable=${stable} unstable=${unstable}`);
});

await test("checkpointTrim=true keeps consecutive requests prefix-stable between (infrequent) checkpoints", async () => {
  const { stable, unstable, firstUnstableAt } = prefixStablePairs(checkpointCaptured);
  // Every unstable pair must correspond to a checkpoint firing (rare); the large majority of pairs must be stable.
  const total = stable + unstable;
  assert.ok(unstable >= 2, `expected at least 2 checkpoint firings over ${checkpointCaptured.length} steps, got ${unstable}`);
  assert.ok(unstable / total < 0.25, `expected checkpoints to be a small minority of pairs, got stable=${stable} unstable=${unstable} (${Math.round((unstable / total) * 100)}%)`);
  assert.ok(firstUnstableAt !== null && firstUnstableAt > 2, "the very first requests (before any growth) must be trivially stable");
});

await test("checkpointTrim fires far less often than legacy trim over the same growth pattern", async () => {
  const legacy = prefixStablePairs(legacyCaptured).unstable;
  const checkpoint = prefixStablePairs(checkpointCaptured).unstable;
  assert.ok(checkpoint < legacy, `expected fewer trim-caused breaks under checkpointTrim, got legacy=${legacy} checkpoint=${checkpoint}`);
});

await test("default (checkpointTrim omitted) behaves exactly like legacy false: no behavior change for existing callers", async () => {
  const omitted = await captureRequests(undefined);
  assert.deepEqual(omitted, legacyCaptured, "omitting checkpointTrim must reproduce the same requests as explicit false");
});

console.log(`TRIM CHECKPOINT: ${failures ? `${failures} failed` : "OK"}`);
process.exitCode = failures ? 1 : 0;
