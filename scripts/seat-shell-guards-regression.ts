/** A seat's shell must not reach a hub by default. Two cases from swarm-000525-jcz8: a recruit's bare script run drove
 * the live hub, and with PORT scrubbed from seats a bare `node dist/swarm.js` falls back to 7717, the operator's hub;
 * and smoke.ts failed in every recruit shell on the inherited recruit pin. npx tsx scripts/seat-shell-guards-regression.ts */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as env from "../src/env.js";

assert.equal(typeof (env as Record<string, unknown>).seatPortError, "function", "env.ts exports seatPortError");
const { seatPortError } = env;
// the operator's own shell keeps today's default
assert.equal(seatPortError({}, undefined), null);
assert.equal(seatPortError({ PORT: "7717" }, undefined), null);
// a seat (launcher seat or recruit: both carry CHATROOM_SEAT_KEY) must name its port
assert.match(seatPortError({ CHATROOM_SEAT_KEY: "k" }, undefined) ?? "", /--port/);
assert.equal(seatPortError({ CHATROOM_SEAT_KEY: "k" }, "7901"), null);
assert.equal(seatPortError({ CHATROOM_SEAT_KEY: "k", PORT: "7901" }, undefined), null, "an explicit PORT in the seat's own command counts");
// and never the hub it is talking through
assert.match(seatPortError({ CHATROOM_SEAT_KEY: "k", CHATROOM_HEARTBEAT_URL: "http://127.0.0.1:7741/heartbeat" }, "7741") ?? "", /7741.*talking through/);

// the launcher applies it before it touches any hub
const run = spawnSync("npx", ["tsx", "src/swarm.ts", "a task", "--flat"], { env: { ...process.env, CHATROOM_SEAT_KEY: "k", PORT: "" }, encoding: "utf8", timeout: 30_000 });
assert.notEqual(run.status, 0);
assert.match(`${run.stdout}${run.stderr}`, /--port/, `${run.stdout}${run.stderr}`.slice(-300));

// smoke starts its own hubs with the default recruit policy whatever the calling shell pins
const smoke = spawnSync("npx", ["tsx", "scripts/smoke.ts"], { env: { ...process.env, PORT: process.env.SMOKE_PORT ?? "7878", CHATROOM_RECRUIT_AGENT: "claude", CHATROOM_RECRUIT_MODEL: "claude-opus-5-5" }, encoding: "utf8", timeout: 300_000 });
assert.match(smoke.stdout, /SMOKE OK/, `${smoke.stdout}${smoke.stderr}`.slice(-400));
console.log("SEAT SHELL GUARDS REGRESSION OK");
