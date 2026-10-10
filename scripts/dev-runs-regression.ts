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
  const finishers: ((c: number) => void)[] = [];
  let runDir = "";
  const listening = { pid: 5151 };
  const servers: ReturnType<typeof createServer>[] = [];
  const host = {
    resolveCommit: (_repo: string, ref: string) => (COMMIT.startsWith(ref) && ref.length >= 7 ? COMMIT : undefined),
    prepare: async (_repo: string, _sha: string, dir: string) => { runDir = dir; return { tree: "/nowhere", entry_sha256: { "dist/index.js": "ab".repeat(32) } }; },
    listener: () => ({ pid: listening.pid, cwd: join(runDir, "tree") }),
    freePort: async () => {
      const srv = createServer((req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(req.url === "/rooms" ? [{ name: "dev-room" }] : req.url === "/rooms/dev-room" ? body() : {}));
      });
      servers.push(srv);
      await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
      return (srv.address() as AddressInfo).port;
    },
    launch: () => ({ pid: 4242, exited: new Promise<number | null>((r) => { finishers.push(r); }) }),
    fetchJson: async (url: string) => (await fetch(url)).json(),
    stop: async () => { for (const s of servers) { s.closeAllConnections(); s.close(); } },
  };
  return { host, listening, end: (c = 0) => { for (const f of finishers) f(c); }, close: () => { for (const s of servers) { s.closeAllConnections(); s.close(); } } };
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
  const fake = fakeHost(() => devBody({ code_state: { head: "0000000", dirty: true }, usage: { cost_usd: 1.234 } }));
  const { hub, room, pr, b, head } = fixture(t, fake);
  const run = await hub.startDevRun(room.name, b.id, { commit: COMMIT.slice(0, 9), task: "use the change" });
  assert.equal(run.commit, COMMIT, "resolved to the full sha by the hub");
  assert.equal(run.requested_by, "Bob");
  await until(() => run.state === "running");
  await hub.devRuns.observe(run);
  assert.equal(run.rooms?.[0]?.speaking_seats, 2);
  assert.equal(run.rooms?.[0]?.cost_usd, 1.234, "the dev room's seat-reported spend is kept for a run total");
  hub.setBoard(room.name, b.id, "verify/x", head(`http://127.0.0.1:${run.port}/rooms/dev-room`));
  const r = await hub.readDevRoom(room.name, "verify/x");
  assert.equal(r?.launched?.run, run.id);
  assert.equal(r?.code_head, COMMIT);
  assert.equal(hub.proposalView(room, pr).verification_gaps, undefined, JSON.stringify(hub.proposalView(room, pr).verification_gaps));
  fake.end(0);
  await until(() => run.state === "ended");
  assert.match(room.messages.at(-1)?.content ?? "", /dev run .* ended with exit 0\. What this hub saw: dev-room concluded, 2\/2 agent seats spoke, 30 messages, \$1\.23 seat-reported/);
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
  // a third seat citing Bob's run: it did not start or watch it
  const c = hub.join(room.name, "Carol", "test", {}, undefined, "session-c").participant;
  const run2 = await hub.startDevRun(room.name, b.id, { commit: COMMIT, task: "bob's" });
  await until(() => run2.state === "running");
  await hub.devRuns.observe(run2);
  hub.setBoard(room.name, c.id, "verify/y", head(`http://127.0.0.1:${run2.port}/rooms/dev-room`));
  await hub.readDevRoom(room.name, "verify/y");
  assert.match(hub.proposalView(room, pr).verification_gaps?.find((g) => g.key === "verify/y")?.gaps.join(" | ") ?? "", /started by Bob, not by Carol who cites it/);
  fake.end(0);
  await until(() => run.state === "ended");
  // something else now answers on that port with a different story: the hub uses what it saw while the run was its own
  let fetched = false;
  hub.setBoard(room.name, b.id, "verify/x", head(`http://127.0.0.1:${run.port}/rooms/dev-room`) + "\nagain");
  const r = await hub.readDevRoom(room.name, "verify/x", async () => { fetched = true; return devBody({ participants: [] }); });
  assert.equal(fetched, false);
  assert.equal(r?.speaking_seats, 2);
});

test("a seat that kills the dev hub and binds a stub on its port is caught: the record freezes and the receipt says so", async (t) => {
  const fake = fakeHost(() => devBody());
  const { hub, room, pr, b, head } = fixture(t, fake);
  const run = await hub.startDevRun(room.name, b.id, { commit: COMMIT, task: "x" });
  await until(() => run.state === "running");
  await hub.devRuns.observe(run);
  assert.equal(run.hub_pid, 5151, "pinned at first sight, serving from the run's own tree");
  fake.listening.pid = 6262; // another process now answers on the port
  hub.setBoard(room.name, b.id, "verify/x", head(`http://127.0.0.1:${run.port}/rooms/dev-room`));
  const r = await hub.readDevRoom(room.name, "verify/x");
  assert.match(r?.launched?.tampered ?? "", /answered from pid 6262, not the dev hub this hub saw start \(pid 5151\)/);
  assert.match(hub.proposalView(room, pr).verification_gaps?.[0]?.gaps.join(" | ") ?? "", /was tampered with/);
  assert.ok(room.messages.some((m) => /Nothing it serves from now on is vouched for/.test(m.content)));
  fake.end(0);
  await until(() => run.state === "ended");
});

test("a seat that only wrote to the board or challenged counts as having acted (chat alone said 0 of 2)", async (t) => {
  const fake = fakeHost(() => devBody({ participants: [{ agent: "claude", messages: 0, output: { claims: 0, evidence: 1, verifies: 0, proposals: 1, challenges: 0 } }, { agent: "claude", messages: 0, output: { challenges: 1 } }] }));
  const { hub, room, b } = fixture(t, fake);
  const run = await hub.startDevRun(room.name, b.id, { commit: COMMIT, task: "x" });
  await until(() => run.state === "running");
  await hub.devRuns.observe(run);
  assert.equal(run.rooms?.[0]?.speaking_seats, 2);
  fake.end(0);
  await until(() => run.state === "ended");
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

test("stop() unregisters the run's worktree from the project's repo and keeps the room log (verifier: 5 left registered)", async () => {
  const { realHost } = await import("../src/hub/dev-runs.js");
  const { execFileSync } = await import("node:child_process");
  const { existsSync, mkdirSync, realpathSync, writeFileSync } = await import("node:fs");
  const repo = process.cwd();
  const head = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "devrun-stop-")));
  const tree = join(dir, "tree");
  execFileSync("git", ["-C", repo, "worktree", "add", "--detach", "-q", tree, head]);
  mkdirSync(join(tree, "data"));
  writeFileSync(join(tree, "data", "room.jsonl"), "{}\n");
  try {
    await realHost.stop({ dir } as Parameters<typeof realHost.stop>[0]);
    const listed = execFileSync("git", ["-C", repo, "worktree", "list", "--porcelain"], { encoding: "utf8" });
    assert.ok(!listed.includes(tree), "the run's tree is still a registered worktree");
    assert.ok(existsSync(join(dir, "run-data", "room.jsonl")), "the room log was not kept");
  } finally {
    try { execFileSync("git", ["-C", repo, "worktree", "remove", "--force", tree], { stdio: "ignore" }); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});
