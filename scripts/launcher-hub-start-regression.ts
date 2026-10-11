/**
 * The launcher waits for the hub it starts as long as a loaded machine needs (swarm-180216-182a, friction/machine-load).
 * ensureHub gave a freshly started hub 10 s (50 x 200 ms); at load average 150-200 on this shared machine the hub took
 * 12-20 s to answer (smoke measured 12, 17, 18, 20 s), so a run would die "hub did not start" with its seats never
 * launched. The wait is now waitForHub(url, ms) with CHATROOM_HUB_START_MS (default 90 s), the same window smoke got
 * in 7c8c2f19. Red on main: waitForHub does not exist. Run: npx tsx scripts/launcher-hub-start-regression.ts
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import * as env from "../src/env.js";

const E = env as Record<string, any>;
assert.equal(typeof E.waitForHub, "function", "env.ts exports waitForHub");
assert.equal(E.HUB_START_MS, 90_000, "the default start window is 90 s");
// a hub that starts answering after 1.5 s: a 1 s window gives up, a 5 s window waits for it
const port = 7000 + Math.floor(Math.random() * 900);
const later = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slow = createServer((_q, s) => s.end("{}"));
setTimeout(() => slow.listen(port, "127.0.0.1"), 1500);
assert.equal(await E.waitForHub(`http://127.0.0.1:${port}`, 1000), false, "a window shorter than the start gives up");
const t0 = Date.now();
assert.equal(await E.waitForHub(`http://127.0.0.1:${port}`, 5000), true, "a window longer than the start waits for it");
assert.ok(Date.now() - t0 < 5000);
slow.close();
await later(10);
// the launcher uses it, not its own 50 x 200 ms loop
const swarm = (await import("node:fs")).readFileSync(new URL("../src/swarm.ts", import.meta.url), "utf8");
assert.match(swarm, /waitForHub\(URL_/, "ensureHub waits with waitForHub");
assert.ok(!/for \(let i = 0; i < 50; i\+\+\) \{\s*try \{\s*await fetch\(URL_\);/.test(swarm), "the 10 s loop is gone");
console.log("launcher-hub-start-regression OK");
process.exit(0);
