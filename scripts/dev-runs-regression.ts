/**
 * A dev_room receipt is evidence only when this hub started that dev run itself (swarm-082539-kns2, claim/verification;
 * round-1 remaining/verification item 1, review/verify-gaps item 3). Before: any loopback server answering
 * GET /rooms/<room> with a hand-written body naming the right commit closed the gap. After: such a receipt still counts
 * as read, but carries "not started by this hub", so the conclusion reads Verified PARTIAL; a run the hub built and
 * watched (src/hub/dev-runs.ts) takes its commit from the hub's own record, not from the dev hub's word.
 * Run: npx tsx --test scripts/dev-runs-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hub } from "../src/hub.js";

const COMMIT = "e4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d";
const devBody = (over: Record<string, unknown> = {}) => ({
  name: "dev-room", state: "concluded", code_state: { head: COMMIT.slice(0, 7), dirty: false }, message_count: 30,
  participants: [{ agent: "claude", messages: 4 }, { agent: "claude", messages: 2 }], ...over,
});

/** a stand-in for git, tsc and the launcher: "launches" by starting a stub dev hub, and exits when told */
function fakeHost(body: () => unknown) {
  let finish: (c: number) => void = () => {};
  const servers: ReturnType<typeof createServer>[] = [];
  const host = {
    resolveCommit: (_repo: string, ref: string) => (COMMIT.startsWith(ref) && ref.length >= 7 ? COMMIT : undefined),
    prepare: async () => ({ tree: "/nowhere", entry_sha256: { "dist/index.js": "ab".repeat(32) } }),
    freePort: async () => {
      const srv = createServer((req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(req.url === "/rooms" ? [{ name: "dev-room" }] : req.url === "/rooms/dev-room" ? body() : {}));
      });
      servers.push(srv);
      await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
      return (srv.address() as AddressInfo).port;
    },
    launch: () => ({ pid: 4242, exited: new Promise<number | null>((r) => { finish = r; }) }),
    fetchJson: async (url: string) => (await fetch(url)).json(),
    stop: async () => { for (const s of servers) { s.closeAllConnections(); s.close(); } },
  };
  return { host, end: (c = 0) => finish(c), close: () => { for (const s of servers) { s.closeAllConnections(); s.close(); } } };
}

function fixture(t: { after: (fn: () => void) => void }, fake?: ReturnType<typeof fakeHost>) {
  const dir = mkdtempSync(join(tmpdir(), "dev-runs-"));
  const hub = new Hub({ dataDir: dir, cwd: dir, ...(fake ? { devRunHost: fake.host } : {}) });
  const name = "dev-runs-test";
  const a = hub.join(name, "Alice", "test", { requireVerification: true, requireChallenge: false, expectedParticipants: 2 }, undefined, "session-a").participant;
  const b = hub.join(name, "Bob", "test", {}, undefined, "session-b").participant;
  const room = hub.getRoom(name);
  hub.setBoard(name, a.id, "verify/own-run", "the author's own run");
  const pr = hub.propose(name, a.id, `Ship commit ${COMMIT.slice(0, 7)}.`);
  t.after(() => { clearTimeout(room.nudgeTimer); clearTimeout(room.openingsTimer); fake?.close(); rmSync(dir, { recursive: true, force: true }); });
  const head = (dev: string) => JSON.stringify({ proposal: pr.id, command: "npx tsx scripts/x.ts", cwd: "/repo", base_commit: "a1b2c3d", base_exit_code: 1, commit: COMMIT.slice(0, 7), exit_code: 0, output_tail: "ok", dev_room: dev });
  return { hub, room, pr, a, b, head, dir };
}

const until = async (f: () => boolean, ms = 5000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 20)); } };

test("a forged dev room (a static body on loopback naming the right commit) no longer closes the gap", async (t) => {
  const { hub, room, pr, b, head } = fixture(t);
  const srv = createServer((_req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(devBody())); });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  t.after(() => { srv.closeAllConnections(); srv.close(); });
  hub.setBoard(room.name, b.id, "verify/x", head(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/rooms/dev-room`));
  const r = await hub.readDevRoom(room.name, "verify/x");
  assert.equal(r?.speaking_seats, 2, "the body was read");
  const gaps = hub.proposalView(room, pr).verification_gaps?.[0]?.gaps ?? [];
  assert.ok(gaps.some((g) => /not started by this hub/.test(g)), `forged receipt closed every gap: ${JSON.stringify(gaps)}`);
});

test("a run this hub started takes the commit from its own record, and a reviewer's run closes the gap", async (t) => {
  // the dev hub lies about its commit; the hub's record wins
  const fake = fakeHost(() => devBody({ code_state: { head: "0000000", dirty: true } }));
  const { hub, room, pr, b, head } = fixture(t, fake);
  const run = await hub.startDevRun(room.name, b.id, { commit: COMMIT.slice(0, 9), task: "use the change" });
  assert.equal(run.commit, COMMIT, "resolved to the full sha by the hub");
  assert.equal(run.requested_by, "Bob");
  await until(() => run.state === "running");
  await hub.devRuns.observe(run);
  assert.equal(run.rooms?.[0]?.speaking_seats, 2);
  hub.setBoard(room.name, b.id, "verify/x", head(`http://127.0.0.1:${run.port}/rooms/dev-room`));
  const r = await hub.readDevRoom(room.name, "verify/x");
  assert.equal(r?.launched?.run, run.id);
  assert.equal(r?.code_head, COMMIT);
  assert.equal(hub.proposalView(room, pr).verification_gaps, undefined, JSON.stringify(hub.proposalView(room, pr).verification_gaps));
  fake.end(0);
  await until(() => run.state === "ended");
  assert.match(room.messages.at(-1)?.content ?? "", /dev run .* ended with exit 0\. What this hub saw: dev-room concluded, 2\/2 agent seats spoke/);
});

test("the proposer's own dev run reads PARTIAL; an ended run's port is not trusted again", async (t) => {
  const fake = fakeHost(() => devBody());
  const { hub, room, pr, a, b, head } = fixture(t, fake);
  const run = await hub.startDevRun(room.name, a.id, { commit: COMMIT.slice(0, 7), task: "demo" });
  await until(() => run.state === "running");
  await hub.devRuns.observe(run);
  hub.setBoard(room.name, b.id, "verify/x", head(`http://127.0.0.1:${run.port}/rooms/dev-room`));
  await hub.readDevRoom(room.name, "verify/x");
  assert.match(hub.proposalView(room, pr).verification_gaps?.[0]?.gaps.join(" | ") ?? "", /started by Alice, the proposal's author/);
  fake.end(0);
  await until(() => run.state === "ended");
  // something else now answers on that port with a different story: the hub uses what it saw while the run was its own
  let fetched = false;
  hub.setBoard(room.name, b.id, "verify/x", head(`http://127.0.0.1:${run.port}/rooms/dev-room`) + "\nagain");
  const r = await hub.readDevRoom(room.name, "verify/x", async () => { fetched = true; return devBody({ participants: [] }); });
  assert.equal(fetched, false);
  assert.equal(r?.speaking_seats, 2);
});

test("refusals: unknown commit, model outside the pins, too many agents, a second live run, a stranger's id", async (t) => {
  const fake = fakeHost(() => devBody());
  const { hub, room, a, b } = fixture(t, fake);
  await assert.rejects(hub.startDevRun(room.name, b.id, { commit: "deadbee", task: "x" }), /not a commit/);
  await assert.rejects(hub.startDevRun(room.name, b.id, { commit: COMMIT, task: "x", model: "gpt-6" }), /model must be one of/);
  await assert.rejects(hub.startDevRun(room.name, b.id, { commit: COMMIT, task: "x", agents: 8 }), /agents must be 2 to 3/);
  await assert.rejects(hub.startDevRun(room.name, "p_nobody", { commit: COMMIT, task: "x" }), /not an active participant/);
  await hub.startDevRun(room.name, b.id, { commit: COMMIT, task: "x" });
  await assert.rejects(hub.startDevRun(room.name, b.id, { commit: COMMIT, task: "y" }), /one at a time/);
  await hub.startDevRun(room.name, a.id, { commit: COMMIT, task: "z" });
  fake.end(0);
});

test("the run record is persisted; a run a restart interrupted replays as failed, its summary kept", async (t) => {
  const fake = fakeHost(() => devBody());
  const { hub, room, b, dir } = fixture(t, fake);
  const run = await hub.startDevRun(room.name, b.id, { commit: COMMIT, task: "x" });
  await until(() => run.state === "running");
  await hub.devRuns.observe(run);
  const again = new Hub({ dataDir: dir, cwd: dir });
  t.after(() => { const r2 = again.getRoom(room.name); clearTimeout(r2.nudgeTimer); clearTimeout(r2.openingsTimer); });
  const back = again.devRuns.status(run.id)[0];
  assert.equal(back?.state, "failed");
  assert.equal(back?.rooms?.[0]?.room, "dev-room");
  assert.equal(back?.commit, COMMIT);
  fake.end(0);
  await until(() => run.state === "ended");
});
