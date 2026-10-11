/**
 * The usage probe asks on the model the stopped seat ran on (merge-review backlog B9a, from
 * docs/self-improvement-swarm-003601-tky5.md). The launcher's probe was one `claude -p` call on MODELS[0], the first
 * worker model, whichever seat had been stopped. The account's limits are per model, so with --models haiku,opus (or
 * a verifier on --verifier-model) a seat stopped on one model was respawned when another model answered, straight into
 * the same wall, or kept waiting for a model it never used. A stub `claude` on PATH records what the probe is run with.
 * Run: npx tsx scripts/usage-probe-model-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import * as respawn from "../src/respawn.js";

const cases: [string, () => Promise<void> | void][] = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);

// at a commit without the probe in respawn.ts these are undefined and every case fails on that
type Probe = (o: { model?: string; cwd: string; env: NodeJS.ProcessEnv; log?: (line: string) => void; who?: string }) => Promise<boolean>;
const probe = (respawn as Record<string, unknown>).claudeUsageProbe as Probe | undefined;
const probeArgs = (respawn as Record<string, unknown>).usageProbeArgs as ((model?: string) => string[]) | undefined;
const need = <T>(v: T | undefined, what: string): T => v ?? assert.fail(`src/respawn.ts exports no ${what}: the probe is still built in the launcher on MODELS[0]`);

/** A stub claude: records its argv, then answers as STUB_SAYS tells it (the limit notice exits 1, as the CLI does). */
const STUB = `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
fs.writeFileSync(path.join(process.env.STUB_RECORD_DIR, Date.now() + '-' + process.pid + '.json'), JSON.stringify(process.argv.slice(2)));
if (process.env.STUB_SAYS === 'limit') { console.log("You've hit your session limit · resets 2:10am (Europe/London)"); process.exit(1); }
console.log('OK');
`;
function stub(says: "ok" | "limit") {
  const dir = mkdtempSync(join(tmpdir(), "usage-probe-"));
  writeFileSync(join(dir, "claude"), STUB, { mode: 0o755 });
  const env = { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH ?? ""}`, STUB_RECORD_DIR: dir, STUB_SAYS: says };
  const argv = () => readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as string[]);
  return { dir, env, argv };
}
const modelOf = (argv: string[]) => (argv.includes("--model") ? argv[argv.indexOf("--model") + 1] : undefined);

test("the probe is run on the model it is given", async () => {
  const s = stub("ok");
  const lines: string[] = [];
  assert.equal(await need(probe, "claudeUsageProbe")({ model: "claude-haiku-5-5", cwd: s.dir, env: s.env, log: (l) => lines.push(l), who: "w2" }), true);
  assert.deepEqual(s.argv().map(modelOf), ["claude-haiku-5-5"]);
  assert.match(lines.join("\n"), /usage probe for w2 on claude-haiku-5-5: usage is back/);
});

test("a seat on the CLI's default model is probed on that default: no --model is invented for it", async () => {
  const s = stub("ok");
  const lines: string[] = [];
  assert.equal(await need(probe, "claudeUsageProbe")({ cwd: s.dir, env: s.env, log: (l) => lines.push(l), who: "w1" }), true);
  assert.deepEqual(s.argv().map((a) => a.includes("--model")), [false]);
  assert.match(lines.join("\n"), /usage probe for w1 on the CLI's default model: usage is back/);
});

test("a refused probe is not ready, and the log says which model refused", async () => {
  const s = stub("limit");
  const lines: string[] = [];
  assert.equal(await need(probe, "claudeUsageProbe")({ model: "claude-opus-5-5", cwd: s.dir, env: s.env, log: (l) => lines.push(l), who: "verifier" }), false);
  assert.match(lines.join("\n"), /usage probe for verifier on claude-opus-5-5: still out of usage/);
});

test("a claude that cannot be started is not ready", async () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-probe-none-"));
  assert.equal(await need(probe, "claudeUsageProbe")({ model: "m", cwd: dir, env: { PATH: dir } }), false);
});

test("the probe's arguments carry the model, or none", () => {
  const args = need(probeArgs, "usageProbeArgs");
  assert.deepEqual(args("claude-sonnet-5-5").slice(-2), ["--model", "claude-sonnet-5-5"]);
  assert.ok(!args().includes("--model"));
  assert.equal(args()[0], "-p");
});

test("the launcher hands each seat's own model to the probe, and no longer the first worker model", () => {
  const swarm = readFileSync(new URL("../src/swarm.ts", import.meta.url), "utf8");
  assert.ok(!/spawn\("claude", \[[^\]]*MODELS\[0\]/.test(swarm), "the probe is still spawned on MODELS[0]");
  assert.match(swarm, /usageReady: \(\) => claudeUsageProbe\(\{ model: probeModel,/, "withRespawn passes the seat's model to the probe");
  // the verifier is probed on the verifier's model, a Claude worker on the model it was launched with
  assert.match(swarm, /withRespawn\("verifier", leadsRoom, VERIFIER_OPENROUTER \? undefined : VERIFIER_MODEL,/);
  assert.match(swarm, /withRespawn\(name, room, agent === "claude" \? model : undefined, mk\)/);
});

let failed = 0;
for (const [name, run] of cases) {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${(e as Error).message.split("\n")[0]}`);
  }
}
console.log(failed ? `\n${failed} of ${cases.length} failed` : `\nUSAGE PROBE MODEL OK (${cases.length} cases)`);
process.exit(failed ? 1 : 0);
