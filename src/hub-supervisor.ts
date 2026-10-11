/**
 * The hub supervisor's (src/hubd.ts) own rules: how its launcher token is written and how long it waits before
 * restarting a hub that died. Where the token and the log live is in src/env.ts, which the launcher reads too.
 *
 * Hub 7717 died with its terminal on 2026-10-10 at 16:28:54 UTC and stayed down 8 minutes until a human restarted it;
 * the launcher had attached to it without a token, so each respawn was refused (board evidence/hub-death-cause in room
 * swarm-003601-tky5-room).
 */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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
