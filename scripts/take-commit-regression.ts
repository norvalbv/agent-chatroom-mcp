/**
 * A take that names a commit is the take for that commit, and a claim's commits are held by its assigned reviewer
 * (swarm-180216-182a, board decision/review-take, friction/duplicate-review and friction/duplicate-review-2). Twice in one
 * hour two seats reviewed the same commit and the second learned it at its finished write: ba181129 (the verifier and
 * the assigned reviewer, ~10 min lost) and c0dd54e4 (the assigned reviewer and a seat the author had asked instead,
 * ~12 min lost, although that seat had written take/review/c0dd54e4 first). Seats spelled the same piece two ways
 * (take/review/<sha>, take/review-<sha>), and nothing tied a take to the reviewer the hub had already assigned: of the 6
 * claims with an assigned reviewer, all 6 reviewers wrote their review; both duplicates came from a seat not assigned.
 * Run: npx tsx scripts/take-commit-regression.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";

const cases: [string, () => Promise<void> | void][] = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);
const throws = (run: () => unknown, re: RegExp) => assert.throws(run, (e: Error) => re.test(e.message) || assert.fail(`unexpected message: ${e.message}`));

// a repository with one commit by each of two seats, as seat worktrees make them (author = seat name, from the launcher's env)
const repo = mkdtempSync(join(tmpdir(), "take-commit-repo-"));
const git = (args: string[], author = "launcher") => {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: author, GIT_AUTHOR_EMAIL: `${author}@swarm.local`, GIT_COMMITTER_NAME: author, GIT_COMMITTER_EMAIL: `${author}@swarm.local` } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
git(["init", "-q"]);
const commit = (author: string, file: string) => { writeFileSync(join(repo, file), `${file} by ${author}\n`); git(["add", file]); git(["commit", "-q", "-m", `${file}`], author); return git(["rev-parse", "HEAD"]).slice(0, 8); };
const BASE = commit("launcher", "base.txt");
const A1 = commit("alice", "a1.txt");
const B1 = commit("bob", "b1.txt");

let serial = 0;
function room(opts: { dataDir?: string } = {}) {
  const h = new Hub({ dataDir: opts.dataDir });
  const name = `take-commit-${++serial}`;
  const seats = ["alice", "bob", "carol", "dave"].map((n) => {
    const p = h.join(name, n, "test", {}, undefined, `sess-${name}-${n}`).participant;
    h.bindSeat(`key-${name}-${n}`, `sess-${name}-${n}`, repo);
    return p;
  });
  const [a, b, c, d] = seats;
  return { h, name, a: a!, b: b!, c: c!, d: d! };
}
const claim = (h: Hub, name: string, pid: string, owner: string, area: string) => h.setBoard(name, pid, `claim/${area}`, JSON.stringify({ area, owner, status: "open" }))!;

test("two spellings of a take for one commit are one take: the second seat is told who holds it", () => {
  const { h, name, c, d } = room();
  h.setBoard(name, c.id, `take/review-${A1}`, "carol reviewing with an own check");
  throws(() => h.setBoard(name, d.id, `take/review/${A1}`, "dave reviewing"), new RegExp(`commit ${A1} is already taken: "take/review-${A1}" is held by carol`));
  throws(() => h.setBoard(name, d.id, `take/rerun/${A1}`, "dave reruns"), /is held by carol/);
  // a different commit, or a key with no commit in it, is nobody else's business
  h.setBoard(name, d.id, `take/review-${B1}`, "dave reviews bob's");
  h.setBoard(name, d.id, "take/benchlock", "dave has the bench");
  // carol's own second key on her commit passes; once she releases both, dave may take it
  h.setBoard(name, c.id, `take/rerun-${A1}`, "carol reruns too");
  h.setBoard(name, c.id, `take/review-${A1}`, "");
  h.setBoard(name, c.id, `take/rerun-${A1}`, "");
  h.setBoard(name, d.id, `take/review/${A1}`, "dave reviewing now");
});

test("a claim's commits are held by its hub-assigned reviewer: another seat's take is refused before the work, with who to ask", () => {
  const { h, name, a, d } = room();
  const e = claim(h, name, a.id, "alice", "session-reap");
  const reviewer = e.reviewer!;
  assert.ok(reviewer && reviewer !== "alice");
  const other = [h.getRoom(name).participants.values()].flatMap((x) => [...x]).find((p) => p.name !== "alice" && p.name !== reviewer)!;
  throws(() => h.setBoard(name, other.id, `take/review/${A1}`, "reviewing, the author asked me"),
    new RegExp(`${reviewer} is the hub-assigned reviewer of alice's "claim/session-reap", and ${A1} is alice's commit.*review/${A1}-${other.name}`));
  // the author may hand its commit to the seat it asked: that is the author choosing, and the seat accepts as usual
  h.setBoard(name, a.id, `take/review/${A1}`, `@${other.name} the assigned reviewer is busy, please take it`);
  h.setBoard(name, other.id, `take/review/${A1}`, "accepted, reviewing");
  h.setBoard(name, other.id, `take/review/${A1}`, "");
  // the assigned reviewer takes it; the author's own take on its commit passes; a commit by nobody with a claim passes
  const rev = [...h.getRoom(name).participants.values()].find((p) => p.name === reviewer)!;
  h.setBoard(name, rev.id, `take/review-${A1}`, "assigned, reviewing");
  h.setBoard(name, a.id, `take/fix-${A1.slice(0, 7)}x`, "not a commit token, passes");
  h.setBoard(name, d.id === rev.id ? other.id : d.id, `take/review-${BASE}`, "the launcher's commit: nobody is assigned");
});

test("when the assigned reviewer has left, anyone may take the commit", () => {
  const { h, name, a } = room();
  const e = claim(h, name, a.id, "alice", "inbox-cap");
  const rev = [...h.getRoom(name).participants.values()].find((p) => p.name === e.reviewer)!;
  const other = [...h.getRoom(name).participants.values()].find((p) => p.name !== "alice" && p.id !== rev.id)!;
  h.leave(name, rev.id, "done, nothing left undone");
  h.setBoard(name, other.id, `take/review-${A1}`, "the reviewer left, I take it");
});

test("a seat with no known worktree is not checked against claims (the commit cannot be read), only against other takes", () => {
  const h = new Hub({});
  const name = "take-commit-nows";
  const a = h.join(name, "alice", "test", {}, undefined, "s-a").participant;
  const b = h.join(name, "bob", "test", {}, undefined, "s-b").participant;
  const c = h.join(name, "carol", "test", {}, undefined, "s-c").participant;
  claim(h, name, a.id, "alice", "x");
  h.setBoard(name, b.id, `take/review-${A1}`, "bob");
  throws(() => h.setBoard(name, c.id, `take/review/${A1}`, "carol"), /is held by bob/);
});

test("each refusal is a take record with its reason and commit", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "take-commit-"));
  const { h, name, a, c, d } = room({ dataDir });
  h.setBoard(name, c.id, `take/review-${B1}`, "carol");
  throws(() => h.setBoard(name, d.id, `take/review/${B1}`, "dave"), /is held by carol/);
  const e = claim(h, name, a.id, "alice", "y");
  const other = [...h.getRoom(name).participants.values()].find((p) => p.name !== "alice" && p.name !== e.reviewer)!;
  throws(() => h.setBoard(name, other.id, `take/review/${A1}`, "x"), /hub-assigned reviewer/);
  const log = readdirSync(dataDir).filter((f) => f.endsWith(".jsonl")).flatMap((f) => readFileSync(join(dataDir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>));
  const refused = log.filter((x) => x.type === "take" && x.action === "refused");
  assert.deepEqual(refused.map((x) => [x.reason, x.commit, x.holder]), [["same-commit", B1, "carol"], ["assigned-reviewer", A1, e.reviewer]]);
});

let failed = 0;
for (const [name, run] of cases) {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${(e as Error).message.split("\n")[0]}`);
  }
}
console.log(failed ? `\n${failed} of ${cases.length} failed` : `\nTAKE COMMIT OK (${cases.length} cases)`);
process.exit(failed ? 1 : 0);
