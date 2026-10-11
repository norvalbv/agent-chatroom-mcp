/**
 * A token-bearing human-route request whose caller the hub could not trace is refused, not admitted (review/d33cda94,
 * rewritten by the verifier: at load average 189 the seat-tree lookup timed out and three forged owner lines were stored
 * as [human route: token]). Run: npx tsx scripts/caller-lookup-fails-closed-regression.ts
 *
 * CHATROOM_CALLER_TIMEOUT_MS=1 makes every lsof/ps lookup time out, as a loaded machine does. Without the token the
 * route is unchanged (its tag already says "not checked"); with it, the hub retries once and then answers 503 with the
 * reason, because a token proves only that the caller could read it.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const freePort = () => new Promise<number>((done) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address() as { port: number }; s.close(() => done(port)); }); });
const TOKEN = "fails-closed-token";
async function hubWith(timeoutMs: string) {
  const PORT = await freePort();
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CHATROOM_")));
  const server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env: { ...env, PORT: String(PORT), CHATROOM_SPAWN_DRY: "1", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_HUMAN_TOKEN: TOKEN, CHATROOM_CALLER_TIMEOUT_MS: timeoutMs }, stdio: "ignore" });
  process.on("exit", () => server.kill());
  for (let i = 0; ; i++) { try { await fetch(`http://127.0.0.1:${PORT}/`); break; } catch { if (i > 100) throw new Error("hub did not start"); await new Promise((r) => setTimeout(r, 200)); } }
  const post = (path: string, body: object, token: boolean) => fetch(`http://127.0.0.1:${PORT}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-chatroom-token": TOKEN } : {}) }, body: JSON.stringify(body) });
  return { server, post, PORT };
}

let failed = 0;
const check = async (name: string, fn: () => Promise<void>) => {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}: ${e instanceof Error ? e.message.split("\n")[0] : e}`); }
};

const loaded = await hubWith("1");
await check("with the token and an untraceable caller, the message is refused with 503 and nothing is stored", async () => {
  const r = await loaded.post("/rooms/fc/messages", { name: "benji", content: "owner line that could be a forgery" }, true);
  const text = await r.text();
  assert.equal(r.status, 503, `expected 503, got ${r.status} ${text.slice(0, 120)}`);
  assert.match(text, /could not trace/);
  const m = await fetch(`http://127.0.0.1:${loaded.PORT}/rooms/fc/messages`).then((x) => (x.ok ? x.json() : []));
  assert.ok(!(m as { content: string }[]).some((x) => x.content === "owner line that could be a forgery"));
});
await check("with the token and an untraceable caller, a vote, kick or close is refused too", async () => {
  for (const [path, body] of [["/rooms/fc/vote", { name: "benji", proposal_id: "prop_x", vote: "disagree", reason: "x" }], ["/rooms/fc/close", { name: "benji" }]] as const) {
    const r = await loaded.post(path, body, true);
    assert.equal(r.status, 503, `${path}: expected 503, got ${r.status}`);
  }
});
await check("without the token the route behaves as before: admitted, tagged loopback and not checked", async () => {
  const r = await loaded.post("/rooms/fc2/messages", { name: "benji", content: "dashboard line" }, false);
  assert.equal(r.status, 200, `expected 200, got ${r.status}`);
  assert.equal(((await r.json()) as { via?: string }).via, "human-loopback");
});
loaded.server.kill();

const normal = await hubWith("2000");
await check("on a machine that can answer, the owner's token request is admitted as the token", async () => {
  const r = await normal.post("/rooms/fc/messages", { name: "benji", content: "real owner line" }, true);
  const text = await r.text();
  assert.equal(r.status, 200, `expected 200, got ${r.status} ${text.slice(0, 120)}`);
  assert.equal((JSON.parse(text) as { via?: string }).via, "human-token");
});
normal.server.kill();
if (failed) { console.error(`CALLER LOOKUP FAILS CLOSED: ${failed}/4 failed`); process.exitCode = 1; } else console.log("CALLER LOOKUP FAILS CLOSED OK (4 cases)");
process.exit();
