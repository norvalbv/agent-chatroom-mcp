/**
 * What the hub supervisor (src/hubd.ts) and the launcher (src/swarm.ts) share: where a supervised hub's log and
 * launcher token live, and how long to wait before restarting a hub that died.
 *
 * Hub 7717 died with its terminal on 2026-10-10 at 16:28:54 UTC and stayed down 8 minutes until a human restarted it;
 * the launcher had attached to it without a token, so each respawn was refused (board evidence/hub-death-cause in room
 * swarm-003601-tky5-room).
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type Env = Record<string, string | undefined>;

/** `<checkout>/logs` unless CHATROOM_HUBD_LOG_DIR says otherwise (tests; a hub whose checkout is read-only). */
export const hubLogDir = (root: string, env: Env = process.env) => resolve(env.CHATROOM_HUBD_LOG_DIR ?? resolve(root, "logs"));
export const hubLogFile = (root: string, port: number, env: Env = process.env) => resolve(hubLogDir(root, env), `hub-${port}.log`);
export const launcherTokenFile = (root: string, port: number, env: Env = process.env) => resolve(hubLogDir(root, env), `hub-${port}-token`);

/** The launcher token of the supervised hub on `port` started from checkout `root`; undefined when there is none. */
export function readLauncherToken(root: string, port: number, env: Env = process.env): string | undefined {
  try { return readFileSync(launcherTokenFile(root, port, env), "utf8").trim() || undefined; } catch { return undefined; }
}

/** Readable by this user only: the token lets its holder register a replacement seat. */
export function writeLauncherToken(file: string, token: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  chmodSync(file, 0o600); // mode above applies only when the file is created
}

export const RESTART_MIN_MS = 1_000;
export const RESTART_MAX_MS = 30_000;
/** A hub that stayed up this long was working: its next death restarts after RESTART_MIN_MS again. */
export const STABLE_MS = 60_000;
/** Wait before restarting a hub that ran for `upMs`, given the wait before its own start (0 for the first hub). */
export function restartDelay(previousMs: number, upMs: number): number {
  if (upMs >= STABLE_MS || previousMs <= 0) return RESTART_MIN_MS;
  return Math.min(RESTART_MAX_MS, previousMs * 2);
}

/** The line a launcher prints at launch when --respawn cannot work, or null. */
export function respawnTokenProblem(respawn: boolean, token: string | undefined, port: number): string | null {
  if (!respawn || token) return null;
  return `WARNING: --respawn WILL NOT WORK on :${port}: this launcher has no CHATROOM_LAUNCHER_TOKEN and the hub left no token file, so the hub will refuse every replacement seat. Start the hub with \`npm run hubd\` (it writes logs/hub-${port}-token), or set CHATROOM_LAUNCHER_TOKEN to the hub's token.`;
}
