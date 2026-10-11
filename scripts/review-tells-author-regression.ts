/**
 * A review reaches the author of the commit it reviews (swarm-180216-182a, claim/review-tells-author). In this room 41
 * chat messages (33,315 chars, each pushed to six or seven seats) existed to say "review/<sha> is up" against 118
 * review/* writes, and an author waiting in a held wait learned of its review only from one of them. Gerrit hands the
 * change back to its owner when a reviewer replies (sources/gerrit-attention-set). The hub resolves the commit's author
 * from git in the reviewer's worktree, as the assigned-reviewer rule does, and @-names it once with the verdict.
 * Run: npx tsx scripts/review-tells-author-regression.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";

const cases: [string, () => void][] = [];
const test = (name: string, run: () => void) => cases.push([name, run]);

const repo = mkdtempSync(join(tmpdir(), "review-author-repo-"));
const git = (args: string[], author = "launcher") => {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: author, GIT_AUTHOR_EMAIL: `${author}@swarm.local`, GIT_COMMITTER_NAME: author, GIT_COMMITTER_EMAIL: `${author}@swarm.local` } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
git(["init", "-q"]);
const commit = (author: string, file: string) => { writeFileSync(join(repo, file), `${file} by ${author}\n`); git(["add", file]); git(["commit", "-q", "-m", file], author); return git(["rev-parse", "HEAD"]).slice(0, 8); };
const BASE = commit("launcher", "base.txt");
const A1 = commit("alice", "a1.txt");
const head = (sha: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({ proposal: "pending", command: "npx tsx scripts/x.ts", cwd: "/w", base_commit: BASE, base_exit_code: 1, commit: sha, exit_code: 0, output_tail: "ok", ...over });

let serial = 0;
function room(dataDir?: string) {
  const h = new Hub(dataDir ? { dataDir } : {});
  const name = `review-author-${++serial}`;
  const [a, b, c] = ["alice", "bob", "carol"].map((n) => {
    const p = h.join(name, n, "test", {}, undefined, `s-${name}-${n}`).participant;
    h.bindSeat(`k-${name}-${n}`, `s-${name}-${n}`, repo);
    return p;
  });
  const told = () => h.getRoom(name).messages.filter((m) => /reviewed your/.test(m.content));
  return { h, name, a: a!, b: b!, c: c!, told };
}

test("the commit's author is @-named once with the verdict, in a chat line that wakes a held wait", () => {
  const { h, name, a, b, told } = room();
  const e = h.setBoard(name, b.id, `review/${A1}`, `${head(A1, { unverified: ["no dev room"] })}\nACCEPT: both sentences match the file.`)!;
  const lines = told();
  assert.equal(lines.length, 1);
  assert.match(lines[0]!.content, new RegExp(`^@alice bob reviewed your ${A1} in review/${A1}: passes \\(exit_code 0, base 1\\); not shown: 1\\. ACCEPT: both sentences match the file\\.`));
  assert.equal(lines[0]!.kind, "chat");
  assert.ok(lines[0]!.mentions?.includes(a.id), "it is addressed to the author");
  assert.equal(e.toldAuthor, "alice", "the entry records who was told, for the board_set reply");
  // a rewrite of the same review does not say it again
  h.setBoard(name, b.id, `review/${A1}`, `${head(A1)}\nACCEPT, and the dev room checked too.`);
  assert.equal(told().length, 1);
});

test("a failing review says fails; the author's own review and a review of an unknown commit say nothing", () => {
  const { h, name, a, c, told } = room();
  h.setBoard(name, c.id, `review/${A1}`, `${head(A1, { exit_code: 1 })}\nREJECT: the second sentence is wrong.`);
  assert.match(told()[0]!.content, /carol reviewed your [0-9a-f]+ in review\/[0-9a-f]+: FAILS \(exit_code 1, base 1\)\. REJECT/);
  h.setBoard(name, a.id, `review/${A1}-self`, `${head(A1)}\nmy own check`);
  h.setBoard(name, c.id, "review/deadbeef1", `${head("deadbeef1")}\nno such commit`);
  assert.equal(told().length, 1);
});

test("an author who is not in the room, or a commit by nobody here, gets no line", () => {
  const { h, name, a, b, told } = room();
  h.leave(name, a.id, "done, nothing left undone");
  h.setBoard(name, b.id, `review/${A1}`, `${head(A1)}\nok`);
  h.setBoard(name, b.id, `review/${BASE}`, `${head(BASE)}\nthe launcher's commit`);
  assert.equal(told().length, 0);
});

test("a one-line review (head only) is told without echoing its JSON", () => {
  const { h, name, b, told } = room();
  h.setBoard(name, b.id, `review/${A1}`, head(A1));
  assert.match(told()[0]!.content, /passes \(exit_code 0, base 1\)\.$/);
});

test("each notice is a review_notice record", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "review-author-"));
  const { h, name, b } = room(dataDir);
  h.setBoard(name, b.id, `review/${A1}`, `${head(A1)}\nok`);
  const log = readdirSync(dataDir).filter((f) => f.endsWith(".jsonl")).flatMap((f) => readFileSync(join(dataDir, f), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>));
  assert.deepEqual(log.filter((e) => e.type === "review_notice").map((e) => [e.key, e.commit, e.author, e.by, e.passes]), [[`review/${A1}`, A1, "alice", "bob", true]]);
});

let failed = 0;
for (const [name, run] of cases) {
  try { run(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split("\n")[0]}`); }
}
console.log(failed ? `\n${failed} of ${cases.length} failed` : `\nREVIEW TELLS AUTHOR OK (${cases.length} cases)`);
process.exit(failed ? 1 : 0);
