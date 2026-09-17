/** Run with: npx tsx scripts/seat-search-regression.ts */
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { localTools } from "../src/seat.js";

const fixture = mkdtempSync(join(tmpdir(), "seat-search-regression-"));
writeFileSync(join(fixture, "fixture.txt"), "needle\nother line\n");
process.on("exit", () => rmSync(fixture, { recursive: true, force: true }));
const search = (clamp = (s: string) => s) => localTools(fixture, false, false, clamp).find(t => t.def.function.name === "search")!;

await test("real grep: matches and genuine no-hit stay distinct", async () => {
  assert.match(await search().run({ pattern: "needle" }), /fixture.txt:1:needle/);
  assert.equal(await search().run({ pattern: "absent" }), "(no matches)");
});
await test("real grep: invalid regex is an error", async () => {
  assert.match(await search().run({ pattern: "[" }), /^ERROR: search failed \(exit 2\): .+/s);
});
await test("real grep: missing path is an error", async () => {
  assert.match(await search().run({ pattern: "needle", path: "missing" }), /^ERROR: search failed \(exit 2\): .+/s);
});

// Patch the built-in binding only in this standalone test process; no production injection API.
const realSpawn = childProcess.spawn;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
async function fakeChild(run: (child: any, result: Promise<string>, fireTimeout: () => void) => Promise<void>) {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kills: [] as unknown[], kill(signal?: unknown) { this.kills.push(signal); return true; } });
  let fireTimeout = () => { throw new Error("timeout not installed"); };
  let cleared = false;
  const token = {};
  childProcess.spawn = (() => child) as typeof realSpawn;
  syncBuiltinESMExports();
  globalThis.setTimeout = ((fn: () => void, ms: number) => {
    assert.equal(ms, 60_000);
    fireTimeout = fn;
    return token;
  }) as typeof realSetTimeout;
  globalThis.clearTimeout = ((timer: unknown) => { assert.equal(timer, token); cleared = true; }) as typeof realClearTimeout;
  try {
    const result = Promise.resolve(search().run({ pattern: "needle" }));
    await run(child, result, () => fireTimeout());
    assert.ok(cleared, "terminal event clears timeout");
  } finally {
    childProcess.spawn = realSpawn;
    syncBuiltinESMExports();
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
}
await test("mock: partial matches cannot hide exit errors; stderr is bounded", async () => {
  await fakeChild(async (child, result) => {
    child.stdout.write("partial match\n");
    child.stderr.write("diagnostic ".repeat(2000));
    child.emit("close", 2, null);
    const text = await result;
    assert.match(text, /^ERROR: search failed \(exit 2\): diagnostic/);
    assert.ok(text.length < 4500, "diagnostic is bounded before caller clamp");
  });
});
await test("mock: signal termination is an error", async () => {
  await fakeChild(async (child, result) => {
    child.emit("close", null, "SIGTERM");
    assert.match(await result, /^ERROR: search failed \(signal SIGTERM\)/);
  });
});
await test("mock: spawn error is handled, even before close", async () => {
  await fakeChild(async (child, result) => {
    assert.ok(child.listenerCount("error") > 0, "spawn errors have a listener");
    child.emit("error", new Error("spawn grep ENOENT"));
    assert.match(await result, /^ERROR: search failed \(spawn\): spawn grep ENOENT/);
    child.emit("close", -2, null); // Late close must not change the result.
  });
});
await test("mock: timeout settles without close and kills only its child", async () => {
  await fakeChild(async (child, result, fireTimeout) => {
    fireTimeout();
    const text = await Promise.race([result, new Promise<string>(resolve => realSetTimeout(() => resolve("HUNG"), 100))]);
    assert.match(text, /^ERROR: search failed \(timeout after 60000ms\)/);
    assert.deepEqual(child.kills, ["SIGKILL"]);
    child.emit("close", null, "SIGKILL");
  });
});
await test("caller clamp still controls successes and errors", async () => {
  const clamp = (s: string) => `clamped:${s.slice(0, 30)}`;
  assert.match(await search(clamp).run({ pattern: "needle" }), /^clamped:/);
  assert.match(await search(clamp).run({ pattern: "[" }), /^clamped:ERROR: search failed/);
});
