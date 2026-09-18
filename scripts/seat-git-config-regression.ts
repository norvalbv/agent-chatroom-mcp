/** Run with: npx tsx scripts/seat-git-config-regression.ts
 * Regression for the always-on GITCONFIG guard in src/seat.ts run_command.
 * `git config` writes the repository config that EVERY worktree of the same checkout
 * reads; one seat renamed every commit author for an hour (docs/measurement-swarm-214936.md:5).
 * Like LETHAL, the guard must hold on a --write seat too. RED on main (c0cf5a3): these
 * commands currently run; GREEN once the guard is in place. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { localTools } from "../src/seat.js";

const fixture = mkdtempSync(join(tmpdir(), "seat-gitconfig-regression-"));
process.on("exit", () => rmSync(fixture, { recursive: true, force: true }));

// A real repo so pre-fix `git config user.name x` genuinely succeeds (the bug), not just errors.
const init = spawnSync("git", ["init", fixture], { encoding: "utf8" });
assert.equal(init.status, 0, `git init failed: ${init.stderr}`);
// Never let any (pre-fix) global write touch the machine's real config: redirect it into the fixture.
process.env.GIT_CONFIG_GLOBAL = join(fixture, "global-config");
process.env.GIT_CONFIG_NOSYSTEM = "1";

const runCmd = (write: boolean) => localTools(fixture, write, true, (s: string) => s).find(t => t.def.function.name === "run_command")!;

await test("write seat refuses `git config user.name seat", async () => {
  const res = await runCmd(true).run({ command: "git config user.name seat" });
  assert.match(res, /^Refused:/, "git config must be refused on a write seat");
  assert.match(res, /GIT_AUTHOR_NAME/, "refusal must point at the env-var identity");
  assert.match(res, /worktree/, "refusal must say why (worktrees share the config)");
});

await test("write seat refuses `git config user.email a@b.c`", async () => {
  assert.match(await runCmd(true).run({ command: "git config user.email a@b.c" }), /^Refused:/);
});

await test("read-only seat refuses `git config --global user.name x`", async () => {
  const res = await runCmd(false).run({ command: "git config --global user.name x" });
  assert.match(res, /^Refused:/, "git config --global must be refused on a read-only seat");
  assert.match(res, /GIT_COMMITTER_NAME/);
});

await test("any form: `git --no-pager config user.name x` is refused (write seat)", async () => {
  assert.match(await runCmd(true).run({ command: "git --no-pager config user.name x" }), /^Refused:/);
});

await test("any form: `git -c user.name=x config --list` is refused (read-only seat)", async () => {
  assert.match(await runCmd(false).run({ command: "git -c user.name=x config --list" }), /^Refused:/);
});

await test("any form: `git -C . config user.name x` is refused (write seat)", async () => {
  assert.match(await runCmd(true).run({ command: "git -C . config user.name x" }), /^Refused:/);
});

await test("benign `git status` still runs (write seat)", async () => {
  const res = await runCmd(true).run({ command: "git status" });
  assert.doesNotMatch(res, /^Refused:/);
});

await test("benign `git status` still runs (read-only seat)", async () => {
  const res = await runCmd(false).run({ command: "git status" });
  assert.doesNotMatch(res, /^Refused:/);
});

await test("guard order intact: LETHAL still refused on a write seat", async () => {
  assert.match(await runCmd(true).run({ command: "pkill node" }), /^Refused:/);
});

await test("guard order intact: MUTATING still refused on a read-only seat", async () => {
  assert.match(await runCmd(false).run({ command: "git commit -am x" }), /^Refused:/);
});
