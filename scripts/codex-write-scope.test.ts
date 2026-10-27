/** A codex seat that may write runs codex's own workspace-write sandbox: its worktree, $TMPDIR and /tmp, plus the git
 * paths a commit on its swarm/<run>/<seat> branch needs (the worktree's gitdir and the shared objects, refs and logs;
 * never config or hooks). Before, a write seat passed no sandbox and inherited ~/.codex/config.toml's
 * danger-full-access, so it could write anywhere the user can (RSI-6 chair #839). The probe runs the launcher's own
 * flags through `codex sandbox` (seatbelt, no model call) and is skipped where codex is not installed.
 *   node --import tsx --test scripts/codex-write-scope.test.ts */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { codexArgs } from "../src/codex-seat.ts";

// under $HOME like a real project, not $TMPDIR or /tmp, which workspace-write leaves writable
const base = realpathSync(mkdtempSync(join(homedir(), ".codex-scope-")));
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "codex-scope-")));
after(() => { rmSync(base, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); });
const git = (cwd: string, ...a: string[]) => spawnSync("git", ["-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { encoding: "utf8" });
git(base, "init", "-q", "repo");
mkdirSync(join(base, "outside"));
const repo = join(base, "repo"), wt = join(base, "wt"), common = join(repo, ".git"), outside = join(base, "outside");
git(repo, "commit", "-q", "--allow-empty", "-m", "init");
const main = git(repo, "branch", "--show-current").stdout.trim();
git(repo, "worktree", "add", "-q", "-b", "swarm/run/seat", wt);
const url = "http://127.0.0.1:1/mcp";
const pair = (args: string[], key: string) => args.find((a, i) => args[i - 1] === "-c" && a.startsWith(`${key}=`))?.slice(key.length + 1);

test("a write seat runs workspace-write, scoped to the git paths a commit on its own worktree branch needs", () => {
  const rw = codexArgs({ cwd: wt, mcpUrl: url, readOnly: false });
  assert.deepEqual(rw.slice(rw.indexOf("-s"), rw.indexOf("-s") + 2), ["-s", "workspace-write"], rw.join(" "));
  assert.deepEqual(JSON.parse(pair(rw, "sandbox_workspace_write.writable_roots") ?? "null"),
    [join(common, "worktrees", "wt"), join(common, "objects"), join(common, "refs", "heads", "swarm", "run"), join(common, "logs", "refs", "heads", "swarm", "run")],
    "refs and logs only for the seat's own run: not main, not any other branch (decision/chair-1009)");
  // the room's smoke starts a hub on localhost; workspace-write blocks the network by default
  assert.equal(pair(rw, "sandbox_workspace_write.network_access"), "true");
  assert.equal(rw.at(-1), "-", "the prompt still comes on stdin");
  const ro = codexArgs({ cwd: wt, mcpUrl: url, readOnly: true });
  assert.deepEqual(ro.slice(ro.indexOf("-s"), ro.indexOf("-s") + 2), ["-s", "read-only"]);
  assert.equal(pair(ro, "sandbox_workspace_write.writable_roots"), undefined, "a read-only seat gets no write roots");
  // a detached worktree has no branch of its own: no ref roots, since refs/heads holds main
  git(repo, "worktree", "add", "-q", "--detach", join(base, "detached"));
  assert.deepEqual(JSON.parse(pair(codexArgs({ cwd: join(base, "detached"), mcpUrl: url, readOnly: false }), "sandbox_workspace_write.writable_roots") ?? "null"),
    [join(common, "worktrees", "detached"), join(common, "objects")]);
  // outside git there is nothing to commit: workspace-write with no extra roots
  assert.equal(pair(codexArgs({ cwd: scratch, mcpUrl: url, readOnly: false }), "sandbox_workspace_write.writable_roots"), "[]");
});

test("CHATROOM_CODEX_WRITE_SANDBOX=inherit restores the user's codex config for write seats", () => {
  process.env.CHATROOM_CODEX_WRITE_SANDBOX = "inherit";
  try {
    const rw = codexArgs({ cwd: wt, mcpUrl: url, readOnly: false });
    assert.ok(!rw.includes("-s"), rw.join(" "));
    assert.deepEqual(codexArgs({ cwd: wt, mcpUrl: url, readOnly: true }).filter((a, i, all) => all[i - 1] === "-s"), ["read-only"]);
  } finally { delete process.env.CHATROOM_CODEX_WRITE_SANDBOX; }
});

const codex = spawnSync("codex", ["--version"], { encoding: "utf8" });
test("codex sandbox with the launcher's flags: writes in the worktree and /tmp, commits on the seat branch, nothing outside", { skip: codex.status !== 0 && "codex not installed" }, () => {
  const rw = codexArgs({ cwd: wt, mcpUrl: url, readOnly: false });
  const scope = rw.flatMap((a, i) => (rw[i - 1] === "-c" && a.startsWith("sandbox_workspace_write.") ? ["-c", a] : []));
  const mode = rw[rw.indexOf("-s") + 1];
  const script = [
    "touch inside.txt && echo inside=ok",
    `touch ${JSON.stringify(join(outside, "x"))} 2>/dev/null && echo outside=written || echo outside=denied`,
    `touch ${JSON.stringify(join(common, "config.probe"))} 2>/dev/null && echo common=written || echo common=denied`,
    `touch ${JSON.stringify(join(scratch, "t"))} && echo tmp=ok`,
    "git add inside.txt && git -c user.email=t@t -c user.name=t commit -q -m probe && echo commit=ok",
    `git update-ref refs/heads/${main} HEAD 2>/dev/null && echo move-main=written || echo move-main=denied`,
    "git branch other 2>/dev/null && echo new-branch=written || echo new-branch=denied",
  ].join("; ");
  const r = spawnSync("codex", ["sandbox", "-c", `sandbox_mode="${mode}"`, ...scope, "--", "sh", "-c", script], { cwd: wt, encoding: "utf8" });
  const out = r.stdout + r.stderr;
  assert.match(out, /inside=ok/, out);
  assert.match(out, /outside=denied/, out);
  assert.ok(!existsSync(join(outside, "x")), "nothing was written outside the scope");
  assert.match(out, /common=denied/, "the shared .git itself (config, hooks) stays read-only");
  assert.match(out, /tmp=ok/, out);
  assert.match(out, /commit=ok/, out);
  assert.equal(git(wt, "log", "-1", "--format=%s").stdout.trim(), "probe", "the commit landed on the seat branch");
  // the shared repo's other branches, main included, stay where they were (claude-opus-5-5-1's review of b7019097)
  assert.match(out, /move-main=denied/, out);
  assert.match(out, /new-branch=denied/, out);
  assert.equal(git(repo, "log", "-1", "--format=%s", main).stdout.trim(), "init", "main did not move");
});
