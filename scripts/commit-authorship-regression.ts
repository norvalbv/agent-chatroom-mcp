/** Hermetic git identity regression; config writes only target a disposable repo. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { seatGitIdentity, seatChildEnv, SEAT_ENV_EXCLUSIONS } from '../src/env.js';

const expected = { GIT_AUTHOR_NAME: 'seat-abc', GIT_AUTHOR_EMAIL: 'seat-abc@swarm.local', GIT_COMMITTER_NAME: 'seat-abc', GIT_COMMITTER_EMAIL: 'seat-abc@swarm.local' };
assert.deepEqual(seatGitIdentity('seat-abc'), expected);
const inherited: Record<string, string> = Object.fromEntries(Object.keys(expected).map(k => [k, 'inherited-human']));
const source: Readonly<Record<string, string>> = Object.freeze({ ...inherited, CHATROOM_HUMAN_TOKEN: 'synthetic', KEEP_ME: 'yes' });
const named = seatChildEnv(source, 'seat-abc');
for (const [key, value] of Object.entries(expected)) assert.equal(named[key], value);
for (const key of SEAT_ENV_EXCLUSIONS) assert.equal(Object.hasOwn(named, key), false);
assert.equal(named.MCP_TOOL_TIMEOUT, '120000');
assert.equal(named.KEEP_ME, 'yes');
assert.equal(source.GIT_AUTHOR_NAME, 'inherited-human');
const unnamed = seatChildEnv({ KEEP_ME: 'yes' });
for (const key of Object.keys(expected)) assert.equal(Object.hasOwn(unnamed, key), false, `no-name must not add ${key}`);
for (const [key, value] of Object.entries(inherited)) assert.equal(seatChildEnv(source)[key], value, 'no-name preserves inherited identity');

const dir = mkdtempSync(join(tmpdir(), 'commit-authorship-'));
try {
  const home = join(dir, 'home'); mkdirSync(home);
  // Explicit allowlist: no inherited GIT_*, config, signing or hooks from the real repo/home.
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (cwd: string, e: NodeJS.ProcessEnv, ...args: string[]) => execFileSync('git', args, { cwd, env: e, encoding: 'utf8' }).trim();
  git(dir, env, 'init', '-b', 'main');
  git(dir, env, 'config', 'user.name', 'user1');
  git(dir, env, 'config', 'user.email', 'user1@example.com');
  const commit = (cwd: string, e: NodeJS.ProcessEnv, file: string) => {
    writeFileSync(join(cwd, file), file); git(cwd, e, 'add', file); git(cwd, e, 'commit', '-m', file);
    return git(cwd, e, 'log', '-1', '--format=%an|%ae|%cn|%ce');
  };
  assert.equal(commit(dir, seatChildEnv(env), 'baseline.txt'), 'user1|user1@example.com|user1|user1@example.com');
  const wt = join(dir, 'worker'); git(dir, env, 'worktree', 'add', '-b', 'worker', wt);
  assert.equal(commit(wt, seatChildEnv({ ...env, ...inherited }, 'seat-abc'), 'worker.txt'), 'seat-abc|seat-abc@swarm.local|seat-abc|seat-abc@swarm.local');
  assert.equal(git(dir, env, 'config', 'user.name'), 'user1');
  assert.equal(git(wt, env, 'config', 'user.email'), 'user1@example.com');
  console.log('COMMIT AUTHORSHIP OK (helper, exclusions, inherited override, real repo + worktree commits)');
} finally { rmSync(dir, { recursive: true, force: true }); }
