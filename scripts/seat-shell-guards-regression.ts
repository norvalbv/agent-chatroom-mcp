/** A seat's shell must not start a launcher on a hub by default. In swarm-000525-jcz8 a recruit's bare script run drove
 * the live hub; with PORT scrubbed from seats, a bare `node dist/swarm.js` falls back to 7717, the operator's hub.
 * npx tsx scripts/seat-shell-guards-regression.ts */
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
// compared as numbers, the way the launcher reads them (claude-opus-5-5-2's probe of 5be17f17)
assert.match(seatPortError({ CHATROOM_SEAT_KEY: "k", CHATROOM_HEARTBEAT_URL: "http://127.0.0.1:7741/heartbeat" }, "07741") ?? "", /talking through/);
assert.match(seatPortError({ CHATROOM_SEAT_KEY: "k", CHATROOM_HEARTBEAT_URL: "http://127.0.0.1:7741/heartbeat" }, "7741.0") ?? "", /talking through/);
// a seat never names the operator's hub either
assert.match(seatPortError({ CHATROOM_SEAT_KEY: "k" }, "7717") ?? "", /operator's hub/);

// the launcher applies it before it touches any hub
const run = spawnSync("npx", ["tsx", "src/swarm.ts", "a task", "--flat"], { env: { ...process.env, CHATROOM_SEAT_KEY: "k", PORT: "" }, encoding: "utf8", timeout: 30_000 });
assert.notEqual(run.status, 0);
assert.match(`${run.stdout}${run.stderr}`, /--port/, `${run.stdout}${run.stderr}`.slice(-300));

console.log("SEAT SHELL GUARDS REGRESSION OK");
