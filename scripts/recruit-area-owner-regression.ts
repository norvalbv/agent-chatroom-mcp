/** request_agent(area) must reserve the recruit's claim, then bind its independent reviewer at join.
 * Dry-run spawner, real MCP connections and production index.ts hooks; no provider calls. */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ownHubPort } from "./lib/own-hub.js";
import { Hub } from "../src/hub.js";
import { claimRecruitmentArea } from "../src/hub/coverage/recruitment.js";
import { claimOwners } from "../src/hub/coverage/coverage.js";
import { measureRecruitClaims } from "./recruit-area-owner-measure.js";

const port = await ownHubPort(Number(process.env.PORT ?? 20_000 + Math.floor(Math.random() * 20_000)));
const scratch = mkdtempSync(join(tmpdir(), "recruit-area-owner-"));
const data = join(scratch, "data");
const clients: Client[] = [];
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let child: ChildProcess | undefined;
let hubOutput = "";
const stop = async () => {
  for (const c of clients.splice(0)) await c.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    const done = new Promise((resolve) => child!.once("exit", resolve));
    child.kill("SIGTERM");
    await done;
  }
};
const start = async () => {
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), CHATROOM_INSECURE_LOCAL: "1", CHATROOM_SPAWN_DRY: "1", CHATROOM_NO_RECRUIT: "0", CHATROOM_DATA_DIR: data, CHATROOM_LOG_DIR: join(scratch, "logs"), CHATROOM_RECRUIT_AGENT: "claude", CHATROOM_RECRUIT_MODEL: "claude-opus-5-5" };
  delete env.CHATROOM_SEAT_KEY;
  child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", (b) => { hubOutput += String(b); });
  child.stderr!.on("data", (b) => { hubOutput += String(b); });
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error(hubOutput);
    try { await fetch(`http://127.0.0.1:${port}/`); return; } catch { await pause(100); }
  }
  throw new Error(`hub did not start: ${hubOutput}`);
};
const connect = async (seat: string) => {
  const c = new Client({ name: "recruit-owner-test", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp?seat=${seat}&worktree=${encodeURIComponent(process.cwd())}`)));
  clients.push(c);
  return async (name: string, args: Record<string, unknown>) => {
    const result = await c.callTool({ name, arguments: args });
    const text = (result.content as { text: string }[])[0].text;
    return { error: !!result.isError, text, value: result.isError ? undefined : JSON.parse(text) };
  };
};
const room = "recruit-owner-regression";
const claim = async (call: Awaited<ReturnType<typeof connect>>, key = "claim/engine") => {
  const result = await call("board_get", { room, key });
  assert.equal(result.error, false, result.text);
  return { ...result.value, body: JSON.parse(result.value.text) };
};
const board = async () => {
  const result = await fetch(`http://127.0.0.1:${port}/rooms/${room}`);
  return (await result.json()) as any;
};
const events = () => readFileSync(join(data, `${room}.jsonl`), "utf8").trim().split("\n").map((line) => JSON.parse(line));
try {
  await start();
  let requester = await connect("requester");
  await requester("join_room", { room, name: "requester", agent: "codex" });
  const peer = await connect("peer");
  await peer("join_room", { room, name: "peer", agent: "claude" });
  await requester("board_set", { room, key: "item/engine", text: "Build the engine" });
  const request = await requester("request_agent", { room, area: "engine", name: "builder", brief: "Build item/engine and report its checks.", agent: "claude" });
  assert.equal(request.error, false, request.text);
  const reserved = await claim(requester);
  assert.equal(reserved.by, "builder", "the recruit, not the requester, is board author");
  assert.equal(reserved.body.owner, "builder");
  assert.deepEqual(reserved.body.team, ["builder"], "requester is not enrolled in the team implicitly");
  console.log("ok reservation ownership");

  const recruit = await connect("builder");
  const joined = await recruit("join_room", { room, name: "builder", agent: "claude", role: "recruit" });
  assert.equal(joined.error, false, joined.text);
  const active = await claim(recruit);
  assert.equal(active.by, "builder");
  const snapshot = await board();
  const entry = snapshot.board["claim/engine"];
  assert.ok(entry.reviewer, "join activates a hub-assigned reviewer without a manual claim write");
  assert.notEqual(entry.reviewer, "builder");
  assert.equal(events().filter((e) => e.type === "board" && e.key === "claim/engine").at(-1).entry.workspace.worktree, process.cwd());
  const status = await requester("room_status", { room });
  assert.deepEqual(status.value.coverage.rows.find((r: any) => r.key === "item/engine").owners, ["builder"]);
  console.log("ok join reviewer, workspace and coverage");

  const denied = await requester("board_set", { room, key: "claim/engine", text: JSON.stringify({ owner: "requester", status: "open" }), overwrite: true });
  assert.equal(denied.error, true, "requester cannot overwrite the live recruit's claim");
  const updated = await recruit("board_set", { room, key: "claim/engine", text: JSON.stringify({ ...active.body, note: "building" }) });
  assert.equal(updated.error, false, updated.text);
  const repeat = await recruit("join_room", { room, name: "builder", agent: "claude" });
  assert.equal(repeat.error, false, repeat.text);
  assert.equal((await board()).board["claim/engine"].reviewer, entry.reviewer);
  assert.equal(events().filter((e) => e.type === "recruit_claim" && e.phase === "activated" && e.key === "claim/engine").length, 1);
  console.log("ok owner writes and repeat join is idempotent");

  const before = (await claim(requester)).text;
  const collision = await requester("request_agent", { room, area: "engine", name: "intruder", brief: "Try the already claimed engine again." });
  assert.equal(collision.error, true);
  assert.equal((await claim(requester)).text, before, "collision preserves the existing claim");
  console.log("ok collision preserves existing claim");

  const multi = await requester("request_agent", { room, area: "pair", name: "duo", count: 2, brief: "Two recruits split the independent implementation work." });
  assert.equal(multi.error, false, multi.text);
  const pair = await claim(requester, "claim/pair");
  assert.equal(pair.body.owner, pair.body.team[0]);
  assert.equal(pair.by, pair.body.owner);
  assert.equal(pair.body.team.length, 2);
  assert.ok(!pair.body.team.includes("requester"));
  console.log("ok count=2 has one owner and two team members");

  await stop();
  await start();
  requester = await connect("requester-after-restart");
  await requester("join_room", { room, name: "requester", agent: "codex" });
  const restored = (await board()).board["claim/engine"];
  assert.equal(restored.by, "builder");
  assert.equal(restored.reviewer, entry.reviewer);
  const late = await connect("late-duo");
  const lateJoin = await late("join_room", { room, name: pair.body.owner, agent: "claude", role: "recruit" });
  assert.equal(lateJoin.error, false, lateJoin.text);
  assert.ok((await board()).board["claim/pair"].reviewer, "pending reservations activate after hub restart");
  console.log("ok persistence and pending reservation activation after restart");
  const measurement = measureRecruitClaims(events());
  assert.equal(measurement.reserved_n, 2);
  assert.equal(measurement.recruit_owner_matches_n, 2);
  assert.equal(measurement.activated_n, 2);
  assert.equal(measurement.independent_reviewer_n, 2);
  assert.equal(measurement.owner_updates_after_activation_n, 1);
  console.log("ok telemetry ownership oracle and post-activation owner update count");
  const h = new Hub({ dataDir: join(scratch, "unit-data") });
  const r = "recruit-boundaries";
  const alias = h.join(r, "alias", "codex", {}, undefined, "shared").participant;
  claimRecruitmentArea(h, r, "requester", "solo", ["solo"]);
  const solo = h.join(r, "solo", "codex", {}, undefined, "shared", "recruit").participant;
  const soloEntry = h.getRoom(r).board.get("claim/solo")!;
  assert.equal(soloEntry.reviewer, undefined, "another name on the owner's session cannot review");
  assert.equal(soloEntry.recruitment?.pending, false, "no-reviewer admission still activates once");
  h.join(r, "solo", "codex", {}, solo.id, "shared");
  console.log("ok no-reviewer admission and same-connection aliases");

  const legacy = { text: JSON.stringify({ owner: "requester", team: ["requester", "builder"], note: "claimed at recruitment" }), by: "requester", updatedAt: "t" };
  assert.deepEqual(claimOwners(legacy), ["builder"]);
  assert.deepEqual(claimOwners({ ...legacy, by: "builder", text: JSON.stringify({ owner: "builder", team: ["builder", "second"], requested_by: "requester", note: "claimed at recruitment" }) }), ["builder", "second"]);
  console.log("ok legacy and modern coverage owners");

  h.setBoard(r, alias.id, "claim/manual", JSON.stringify({ owner: "alias", requested_by: "requester", recruitment: { pending: true }, note: "claimed at recruitment" }));
  h.join(r, "alias", "codex", {}, alias.id, "shared");
  assert.equal(h.getRoom(r).board.get("claim/manual")!.recruitment, undefined, "client JSON cannot create a pending reservation");
  h.removeParticipant(r, "solo", "fixture", "exercise system-released claim reclamation");
  const released = h.getRoom(r).board.get("claim/solo")!;
  claimRecruitmentArea(h, r, "requester", "solo", ["successor"]);
  assert.equal(h.getRoom(r).board.get("claim/solo")!.by, "successor");
  assert.equal(released.by, "system");
  console.log("ok forged marker and released claim reclaim");
  const overlapRoom = "recruit-overlap";
  const incumbent = h.join(overlapRoom, "incumbent", "codex", {}, undefined, "incumbent-session").participant;
  const note = "Implement probability labels with readable ownership identifiers and independent reviewer assignment across recruitment boundaries";
  h.setBoard(overlapRoom, incumbent.id, "claim/probability-label-owner", JSON.stringify({ owner: incumbent.name, note }));
  claimRecruitmentArea(h, overlapRoom, "requester", "probability-label-review", ["new-owner"]);
  const pending = h.getRoom(overlapRoom).board.get("claim/probability-label-review")!;
  h.setBoardAs(overlapRoom, pending.by, "claim/probability-label-review", JSON.stringify({ ...JSON.parse(pending.text), note }), pending.recruitment);
  h.join(overlapRoom, "new-owner", "claude", {}, undefined, "new-owner-session");
  h.join(overlapRoom, "new-owner", "claude", {}, undefined, "new-owner-session");
  const overlapEvents = readFileSync(join(scratch, "unit-data", `${overlapRoom}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(overlapEvents.filter((e) => e.type === "overlap_notice" && e.by === "new-owner").length, 1, "activation runs normal first-claim notices exactly once");
  console.log("ok first-activation overlap notice occurs once");
  claimRecruitmentArea(h, overlapRoom, "requester", "will-expire", ["never-joins"]);
  const expiryKey = "claim/will-expire", replacement = JSON.stringify({ owner: incumbent.name, status: "open" });
  assert.throws(() => h.setBoard(overlapRoom, incumbent.id, expiryKey, replacement), /owned by never-joins/);
  const expiring = h.getRoom(overlapRoom).board.get(expiryKey)!;
  expiring.updatedAt = new Date(Date.now() - Hub.STALE_CLAIM_MS - 1).toISOString();
  const reclaimed = h.setBoard(overlapRoom, incumbent.id, expiryKey, replacement)!;
  assert.equal(reclaimed.by, incumbent.name, "a never-joined recruit cannot lock the claim past STALE_CLAIM_MS");
  assert.ok(reclaimed.reviewer, "a reclaimed reservation gets the new owner's reviewer");
  const expired = readFileSync(join(scratch, "unit-data", `${overlapRoom}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.type === "recruit_claim" && e.phase === "expired");
  assert.equal(expired.length, 1);
  assert.equal(expired[0].owner, "never-joins");
  console.log("ok pending reservation expires and a third seat reclaims it");
  console.log("RECRUIT AREA OWNER OK (12 checks)");
} finally {
  await stop();
  rmSync(scratch, { recursive: true, force: true });
}
