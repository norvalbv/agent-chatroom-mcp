/**
 * wake/<pid>: a seat's brief for whoever reads the result of a job it will not wait for.
 * A benchmark round runs an hour or more; a seat that idles in the room until it ends pays for every wake, and a seat
 * that leaves takes with it the only reader of the result (swarm-211613-dpl4 plan/build-room-waiting). So the seat
 * writes the brief, leaves, and the hub starts ONE successor with it when that job ends. A seat still in the room when
 * its job ends is told so itself (Hub.jobEnded) and nothing is started.
 */
import type { Hub } from "../hub.js";
import type { Job } from "./memory.js";
import { now } from "./internal.js";
import type { Participant, Room } from "./types.js";

export const WAKE_KEY = /^wake\/(\d+)$/;
/** what a wake entry starts with once the hub has acted on it: it is never acted on twice */
const SPENT = "[wake spent: ";

export interface Wake { key: string; by: string; pid: number; brief: string; worktree?: string }

/** The departed seat `p`'s own unspent wake entries for the processes that just ended, each spent before its successor is asked for. */
export function wakeSuccessors(hub: Hub, room: Room, p: Participant, job: Job, pids: number[]): void {
  for (const [key, e] of [...room.board]) {
    const pid = Number(WAKE_KEY.exec(key)?.[1]);
    // only the seat whose job it is: another seat's wake/ for this pid starts nobody
    if (!pid || !pids.includes(pid) || e.by !== p.name || !e.text.trim() || e.text.startsWith(SPENT)) continue;
    const mins = Math.round(job.elapsed_s / 60);
    const brief = `You take over from ${hub.shown(room, p)}, who left this room while a job ran rather than wait for it. That job has now ended: pid ${pid} (${job.command.slice(0, 160)}), after about ${mins} min. Nobody has read its result. What they left for you (board entry ${key}):\n${e.text}`;
    const spend = (how: string) => hub.setBoardAs(room.name, p.name, key, `${SPENT}${how}] ${e.text}`);
    if (!hub.onJobWake) { spend("this hub starts no seats"); continue; }
    spend("the hub is starting a successor");
    try {
      const name = hub.onJobWake(room.name, { key, by: p.name, pid, brief, worktree: hub.workspaceOf(p)?.worktree });
      hub.persist({ type: "job_wake", room: room.name, seat: p.name, pid, key, successor: name ?? null, ts: now() });
      hub.announce(room.name, `${name ?? "A successor"} was started by the hub to read the result of ${hub.shown(room, p)}'s job (pid ${pid}), with the brief in ${key}.`);
    } catch (err) {
      hub.announce(room.name, `No successor was started for ${key}: ${(err as Error).message} Whoever is here reads the result of pid ${pid} instead.`);
    }
  }
}
