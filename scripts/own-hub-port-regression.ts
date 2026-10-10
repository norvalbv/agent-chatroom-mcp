/** A script that starts its own hub on PORT then talks to "the hub on PORT". With something already listening there
 * its hub failed to bind and the script drove the other one: in swarm-000525-jcz8 a recruit's bare
 * `npx tsx scripts/seat-exit-regression.ts` inherited the live hub's PORT, created a room on it and made it launch an
 * agent. Each must refuse at once, name the port, and send the listener nothing.
 * npx tsx scripts/own-hub-port-regression.ts */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const SCRIPTS = [
  "away-seat-regression.ts", "claim-workspace-regression.ts", "heartbeat-regression.ts", "questions-regression.ts", "reply-metrics-api.test.ts",
  "room-status-size-regression.ts", "seat-exit-regression.ts", "steer-contract-regression.ts", "steer-hook-regression.ts", "openrouter-smoke.ts",
];

// stands in for somebody else's hub: answers anything, so a script that does not check carries on and talks to it
const requests: string[] = [];
const other = createServer((req, res) => { requests.push(`${req.method} ${req.url}`); res.setHeader("content-type", "application/json"); res.end("{}"); });
await new Promise<void>((done) => other.listen(0, "127.0.0.1", done));
const taken = (other.address() as AddressInfo).port;
assert.ok(taken > 8000, "an ephemeral port (reply-metrics-api refuses anything lower)");

// the hub's own settings must not leak in from a seat's shell; PORT is the one thing under test
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("CHATROOM_")));
const run = (script: string) => new Promise<{ script: string; status: number | null; signal: string | null; out: string }>((done) => {
  // not spawnSync: the listener above has to keep answering while the script runs
  const child = spawn(process.execPath, ["--import", "tsx", `scripts/${script}`], { env: { ...env, PORT: String(taken) }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (chunk) => { out += chunk; });
  child.stderr.on("data", (chunk) => { out += chunk; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
  child.on("close", (status, signal) => { clearTimeout(timer); done({ script, status, signal, out }); });
});

try {
  const failures: string[] = [];
  for (const r of await Promise.all(SCRIPTS.map(run))) {
    const tail = r.out.trim().split("\n").slice(-2).join(" | ").slice(-300);
    if (r.signal) failures.push(`${r.script}: ran until it was killed (${r.signal}) instead of refusing at once: ${tail}`);
    else if (r.status === 0) failures.push(`${r.script}: exited 0 on a port it did not own`);
    else if (!new RegExp(`port ${taken} .*is already in use.*only drives a hub it started`).test(r.out)) failures.push(`${r.script}: exit ${r.status} without naming port ${taken} and the reason: ${tail}`);
  }
  if (requests.length) failures.push(`the hub that was already there received ${requests.length} request(s): ${[...new Set(requests)].slice(0, 6).join(", ")}`);
  assert.deepEqual(failures, [], `\n${failures.join("\n")}`);
} finally {
  other.close();
  other.closeAllConnections();
}
console.log(`OWN HUB PORT REGRESSION OK (${SCRIPTS.length} scripts refused port ${taken}, 0 requests reached it)`);
