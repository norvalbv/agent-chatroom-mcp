/** smoke.ts starts hubs on PORT and PORT+1. With either one taken it used to run for a while and then fail on an
 * unrelated assertion (a seat of swarm-000525-jcz8 lost a run to "already active in stale-openings"); it must refuse
 * at once and name the port. npx tsx scripts/smoke-ports-regression.ts */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";

const blocker = createServer();
await new Promise<void>((done) => blocker.listen(0, "127.0.0.1", done));
const taken = (blocker.address() as { port: number }).port;
try {
  // PORT+1 is the taken one: the main hub's port is free, the second hub's is not
  const run = spawnSync("npx", ["tsx", "scripts/smoke.ts"], { env: { ...process.env, PORT: String(taken - 1) }, encoding: "utf8", timeout: 20_000 });
  const out = `${run.stdout}${run.stderr}`;
  assert.notEqual(run.status, 0, "smoke must fail when its second port is taken");
  assert.equal(run.signal, null, "and fail at once, not run until it is killed");
  assert.match(out, new RegExp(`port ${taken} \\(PORT\\+1\\) is already in use`), out.slice(-400));
  assert.doesNotMatch(out, /SMOKE OK/);
} finally {
  blocker.close();
}
console.log("SMOKE PORTS REGRESSION OK");
