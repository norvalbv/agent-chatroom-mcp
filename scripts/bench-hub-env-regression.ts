/** Regression for claim/measurement (swarm-082539-kns2): the bench's room arm could not switch on any hub
 * mechanism. bench-rq1.ts deleted every CHATROOM_* variable and forced CHATROOM_NO_RECRUIT=1, so the fresh
 * challenger (src/spawner.ts freshChallenger, gated on both) never fired in a bench run and no flag-gated
 * mechanism could be compared within one build. These checks pin the replacement:
 *  1. --hub-env takes only allowlisted mechanism flags; a token, data dir, port or recruit pin is refused.
 *  2. Without --recruit-model the hub still refuses recruitment and strips secrets exactly as before.
 *  3. With --recruit-model (claude-opus-5-5 or claude-sonnet-5-5 only) recruits are pinned to claude and that
 *     model, and the hub is still told to strip secret-shaped .env values.
 *  4. Recruit usage from the hub's /agents is folded into the run: an unfinished or unparsed recruit is
 *     unknown, never zero, so the run's cost coverage drops below complete.
 * No subprocess or network is touched.
 */
import assert from "node:assert/strict";
import { benchHubEnv, parseHubEnv, recruitRecords } from "./bench-hub-env.js";
import { rollupUsage } from "../src/result.js";
import { hubDotEnvOptions } from "../src/env.js";
import { hubArmMismatch } from "./bench-grid.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = { PATH: "/bin", HOME: "/h", OPENROUTER_API_KEY: "secret", CHATROOM_HUMAN_TOKEN: "t", CHATROOM_FRESH_CHALLENGER: "1" };
const where = { port: 19999, dataDir: "/tmp/d", workspace: "/tmp/w", logDir: "/tmp/l" };

// 1. allowlist
assert.deepEqual(parseHubEnv(["CHATROOM_FRESH_CHALLENGER=1", "CHATROOM_FRESH_CHALLENGER_WAIT_MIN=3"]), { CHATROOM_FRESH_CHALLENGER: "1", CHATROOM_FRESH_CHALLENGER_WAIT_MIN: "3" });
for (const bad of ["CHATROOM_HUMAN_TOKEN=x", "CHATROOM_DATA_DIR=/x", "PORT=1", "CHATROOM_RECRUIT_MODEL=x", "CHATROOM_NO_RECRUIT=0", "CHATROOM_FRESH_CHALLENGER", "OPENROUTER_API_KEY=k"])
  assert.throws(() => parseHubEnv([bad]), /--hub-env/, `must refuse ${bad}`);

// 2. default: identical to the old bench hub (inherited CHATROOM_* and secrets gone, recruitment refused)
{
  const env = benchHubEnv(base, where);
  assert.equal(env.CHATROOM_NO_RECRUIT, "1");
  assert.equal(env.CHATROOM_FRESH_CHALLENGER, undefined, "an inherited flag must not leak into the bench hub");
  assert.equal(env.OPENROUTER_API_KEY, undefined);
  assert.equal(env.CHATROOM_HUMAN_TOKEN, undefined);
  assert.equal(env.PORT, "19999");
  assert.equal(env.CHATROOM_DATA_DIR, "/tmp/d");
  assert.equal(env.PATH, "/bin");
}

// 3. flags and recruiting switched on explicitly
{
  const env = benchHubEnv(base, { ...where, hubEnv: { CHATROOM_FRESH_CHALLENGER: "1" }, recruitModel: "claude-sonnet-5-5" });
  assert.equal(env.CHATROOM_FRESH_CHALLENGER, "1");
  assert.equal(env.CHATROOM_NO_RECRUIT, undefined, "--recruit-model must lift the recruitment refusal");
  assert.equal(env.CHATROOM_RECRUIT_AGENT, "claude");
  assert.equal(env.CHATROOM_RECRUIT_MODEL, "claude-sonnet-5-5");
  assert.equal(env.CHATROOM_STRIP_SECRETS, "1", "the hub must still refuse to refill secrets from .env");
  assert.equal(env.OPENROUTER_API_KEY, undefined);
  assert.throws(() => benchHubEnv(base, { ...where, recruitModel: "deepseek/deepseek-v4-flash-0731" }), /recruit-model/);
  // the fresh challenger is a recruit: switched on without --recruit-model, NO_RECRUIT would silently keep it off
  // while result.hub_env recorded it as on (attack/findings/measurement, -5)
  assert.throws(() => benchHubEnv(base, { ...where, hubEnv: { CHATROOM_FRESH_CHALLENGER: "1" } }), /--recruit-model/);
  assert.throws(() => benchHubEnv(base, { ...where, hubEnv: { CHATROOM_FRESH_CHALLENGER_WAIT_MIN: "3" } }), /--recruit-model/);
  assert.equal(benchHubEnv(base, { ...where, hubEnv: { CHATROOM_FRESH_CHALLENGER: "0" } }).CHATROOM_NO_RECRUIT, "1", "an explicit off needs no recruit model");
  // and the hub honours it: src/index.ts loads .env with hubDotEnvOptions(process.env)
  assert.ok(hubDotEnvOptions(env).excludePattern?.test("OPENROUTER_API_KEY"), "a recruiting bench hub must not refill secrets from .env");
  assert.ok(hubDotEnvOptions(benchHubEnv(base, where)).excludePattern?.test("OPENROUTER_API_KEY"));
  assert.equal(hubDotEnvOptions({}).excludePattern, undefined, "an ordinary hub still loads .env as before");
}

// 4. recruit usage
{
  const agents = [
    { name: "fresh-1", model: "claude-sonnet-5-5", agent: "claude", startedAt: "a", endedAt: "b", exitCode: 0, usage: { cost: 0.2, input_tokens: 10, output_tokens: 5 }, brief: "x" },
    { name: "fresh-2", model: "claude-sonnet-5-5", agent: "claude", startedAt: "a", exitCode: undefined, brief: "y" },
  ];
  const recs = recruitRecords(agents);
  assert.equal(recs.length, 2);
  assert.equal(recs[0].usage?.cost, 0.2);
  assert.equal(recs[1].usage, null, "a recruit still running or unparsed is unknown, not zero");
  const seats = [{ usage: { cost: 1, input_tokens: 1, output_tokens: 1 } }];
  const u = rollupUsage([...seats, ...recs])!;
  assert.equal(u.seats, 3);
  assert.equal(u.coverage, "partial");
  assert.equal(u.cost_usd, 1.2);
  assert.deepEqual(recruitRecords("not an array"), []);
}

// 5. the grid never serves an off-arm result as done for an on-arm request (or the reverse)
{
  const dir = mkdtempSync(join(tmpdir(), "bench-hub-env-"));
  try {
    const legacy = join(dir, "legacy.json");
    writeFileSync(legacy, JSON.stringify({ outcome: "task_pass" }));
    const on = join(dir, "on.json");
    writeFileSync(on, JSON.stringify({ outcome: "task_pass", hub_env: { CHATROOM_FRESH_CHALLENGER: "1" }, recruit_model: "claude-sonnet-5-5" }));
    assert.equal(hubArmMismatch(legacy, {}, null), null, "a pre-flag result is the off arm");
    assert.match(hubArmMismatch(legacy, { CHATROOM_FRESH_CHALLENGER: "1" }, "claude-sonnet-5-5") ?? "", /hub_env/);
    assert.equal(hubArmMismatch(on, { CHATROOM_FRESH_CHALLENGER: "1" }, "claude-sonnet-5-5"), null);
    assert.match(hubArmMismatch(on, { CHATROOM_FRESH_CHALLENGER: "1" }, null) ?? "", /recruit_model/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("[bench-hub-env-regression] OK");
