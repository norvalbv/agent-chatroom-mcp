/**
 * --sandbox (launcher) / CHATROOM_SANDBOX=1 (hub recruits): an OS sandbox around what a seat runs, so a seat's
 * `pkill -f <word>` cannot reach the hub, the launcher or another seat. Default off; see docs/reuse-survey-2026-09-23.md
 * ("OS isolation for claude seats", "OS isolation for OpenRouter seats") and todo/sandbox-seats.md.
 *
 * Two engines, one policy:
 * - claude seats: Claude Code's own sandbox, a `sandbox` block merged into the --settings JSON (src/claude-args.ts).
 *   Keys per https://code.claude.com/docs/en/settings-reference (sandbox.*) and /docs/en/sandboxing.
 * - OpenRouter seats: @anthropic-ai/sandbox-runtime (srt, Apache-2.0, https://github.com/anthropics/sandbox-runtime),
 *   the same engine underneath, wrapped around each run_command (src/seat.ts).
 * Never both around one process: macOS cannot nest Seatbelt profiles (probed: `sandbox-exec` inside a sandboxed seat
 * fails with "sandbox_apply: Operation not permitted", exit 71).
 *
 * What the probes on 2026-09-23 showed (Claude Code 2.1.281, srt 0.0.77, macOS):
 * - The settings apply under `claude -p` with the lean flags (--setting-sources project still reads --settings).
 * - pkill inside the sandbox cannot list processes ("sysmond service not found", exit 3); `kill <pid>` of anything
 *   outside gets EPERM. Signals reach only the same sandbox: srt's profile says `(allow signal (target same-sandbox))`.
 * - The sandbox is per command: a process started in one Bash call survives it, but a later call cannot signal it.
 * - A linked worktree commits: Claude Code allows the shared .git and keeps its config and hooks denied; srt needs that
 *   spelled out (sharedGitWrites below).
 * - Writes through the node_modules symlink are denied when only cwd is writable; allowWrite on the link's target
 *   fixes it. Only the cache directories are opened (nodeModulesCaches), so `npm install` cannot rewrite the shared tree.
 * - Loopback: localhost bypasses the sandbox proxy (NO_PROXY), so the hub port is reached only through allowLocalBinding,
 *   which on macOS opens every loopback port; the host:port allowlist entries below are for clients that proxy anyway.
 */
import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

/** npm and GitHub, as in the sandboxing docs' own example (`"github.com", "*.npmjs.org"`), plus GitHub's API/raw hosts. */
export const SANDBOX_DOMAINS: readonly string[] = Object.freeze(["registry.npmjs.org", "*.npmjs.org", "github.com", "*.github.com", "*.githubusercontent.com"]);

/** What every sandboxed seat needs to know about itself. */
export interface SeatSandboxInput {
  /** the directory the seat works in (its worktree, or the checkout for a read-only seat) */
  cwd: string;
  /** may the seat modify files? Read-only seats get the cwd denied, since Bash is in their tool list (READ_TOOLS) */
  write: boolean;
  /** the hub's port, from its MCP URL */
  hubPort?: number;
}

/** The `sandbox` settings block for a claude -p seat. */
export interface ClaudeSandboxSettings {
  enabled: true;
  allowUnsandboxedCommands: false;
  failIfUnavailable: true;
  network: { allowedDomains: string[]; allowLocalBinding: true };
  filesystem: { allowWrite?: string[]; denyWrite?: string[] };
}

export const hubPortOf = (mcpUrl: string): number | undefined => {
  try {
    const u = new URL(mcpUrl);
    return Number(u.port || (u.protocol === "https:" ? 443 : 80));
  } catch {
    return undefined;
  }
};

const hubEntries = (port?: number) => (port ? [`localhost:${port}`, `127.0.0.1:${port}`] : []);
/** macOS spells /tmp as /private/tmp underneath; a deny written with the other spelling would not match. */
const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/**
 * Cache directories inside a node_modules that is a symlink out of the seat's cwd (the launcher links the main
 * checkout's node_modules into every worktree). Tools that cache there (.cache, .vite) fail under a cwd-only sandbox;
 * the rest of the shared tree stays read-only.
 */
export function nodeModulesCaches(cwd: string): string[] {
  const link = join(cwd, "node_modules");
  try {
    if (!lstatSync(link).isSymbolicLink()) return [];
    const target = realpathSync(link);
    const rel = relative(realpathSync(cwd), target);
    if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return []; // points inside cwd: already writable
    return [join(target, ".cache"), join(target, ".vite")];
  } catch {
    return [];
  }
}

/**
 * srt only: a linked worktree keeps its index, refs and objects in the main repository's .git, outside the cwd. Claude
 * Code opens that directory itself (docs: "Git worktrees"); for srt it is opened here with config and hooks denied,
 * matching Claude Code, so `git commit` works and `git config` / hook writes do not.
 */
export function sharedGitWrites(cwd: string): { allowWrite: string[]; denyWrite: string[] } {
  const r = spawnSync("git", ["-C", cwd, "rev-parse", "--git-common-dir"], { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout?.trim()) return { allowWrite: [], denyWrite: [] };
  let common: string;
  try {
    common = realpathSync(resolve(cwd, r.stdout.trim()));
  } catch {
    return { allowWrite: [], denyWrite: [] };
  }
  const rel = relative(realpathSync(cwd), common);
  if (!rel.startsWith("..") && !isAbsolute(rel)) return { allowWrite: [], denyWrite: [] }; // .git inside cwd: srt's own denies cover it
  return { allowWrite: [common], denyWrite: [join(common, "config"), join(common, "hooks")] };
}

/** Claude Code's sandbox for one seat (merged into --settings by claudeArgs). */
export function claudeSandbox({ cwd, write, hubPort }: SeatSandboxInput): ClaudeSandboxSettings {
  const caches = write ? nodeModulesCaches(cwd) : [];
  return {
    enabled: true,
    allowUnsandboxedCommands: false, // no dangerouslyDisableSandbox retry
    failIfUnavailable: true, // refuse to start rather than run unsandboxed
    network: { allowedDomains: [...SANDBOX_DOMAINS, ...hubEntries(hubPort)], allowLocalBinding: true },
    filesystem: write ? (caches.length ? { allowWrite: caches } : {}) : { denyWrite: [real(cwd)] },
  };
}

/**
 * Paths sandbox-runtime lets every sandboxed command write whatever the seat's config says (/dev nodes aside): /tmp/claude,
 * which srt also makes the command's TMPDIR, and two convenience directories under the home directory. From srt 0.0.77
 * dist/sandbox/sandbox-utils.js, getDefaultWritePaths (SANDBOX_OWN_WRITE_PATHS and HOME_CONVENIENCE_WRITE_DIRS). They are
 * named wherever a seat's write scope is stated (srtWriteScope, the README), and scripts/sandbox-seats.test.ts fails if an
 * srt upgrade changes the list.
 */
export const SRT_OWN_WRITES: readonly string[] = Object.freeze(["/tmp/claude", "~/.npm/_logs", "~/.claude/debug"]);

/** The srt config for one OpenRouter seat (src/seat.ts wraps every run_command with it). Shape: SandboxRuntimeConfig. */
export function srtSeatConfig({ cwd, write, hubPort }: SeatSandboxInput) {
  const git = write ? sharedGitWrites(cwd) : { allowWrite: [], denyWrite: [] };
  return {
    network: { allowedDomains: [...SANDBOX_DOMAINS, ...hubEntries(hubPort)], deniedDomains: [] as string[], allowLocalBinding: true },
    filesystem: {
      denyRead: [] as string[],
      // srt denies every write not listed here except its own SRT_OWN_WRITES; a read-only seat gets none of its own
      allowWrite: write ? [real(cwd), ...git.allowWrite, ...nodeModulesCaches(cwd)] : [],
      denyWrite: git.denyWrite,
    },
  };
}
export type SrtSeatConfig = ReturnType<typeof srtSeatConfig>;

/**
 * Where an srt seat's commands can write, in the words the seat and its operator see (run_command's description, the
 * seat's startup log): the config's own allowWrite, its denyWrite as exceptions, then srt's SRT_OWN_WRITES. It is an
 * upper bound: srt also denies some files inside the allowed paths (.git/hooks, shell rc files).
 */
export function srtWriteScope({ filesystem }: SrtSeatConfig): string {
  const own = `sandbox-runtime's own ${SRT_OWN_WRITES.join(", ")} (/tmp/claude is the command's TMPDIR)`;
  if (!filesystem.allowWrite.length) return `writes succeed only under ${own}`;
  const except = filesystem.denyWrite.length ? ` (not ${filesystem.denyWrite.join(", ")})` : "";
  return `writes succeed only under ${filesystem.allowWrite.join(", ")}${except}, and ${own}`;
}

/** Whether the launcher/hub asked for sandboxed seats. */
export const sandboxFromEnv = (env: NodeJS.ProcessEnv = process.env) => env.CHATROOM_SANDBOX === "1";
