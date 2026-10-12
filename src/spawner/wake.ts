/** The hub's wake/<pid> hook (src/hub/wake.ts) served by the spawner: one write seat, cut from the departed seat's worktree HEAD. */
import type { Hub } from "../hub.js";
import { projectOf, type Spawner } from "../spawner.js";

export function attachJobWake(hub: Hub, spawner: Spawner): void {
  hub.onJobWake = (room, wake) => {
    const [rec] = spawner.request({ room, brief: wake.brief, requestedBy: wake.by, parentTopic: hub.getRoom(room).topic, cwd: wake.worktree ? projectOf(wake.worktree) : undefined, baseDir: wake.worktree, canEdit: true, count: 1 });
    return rec?.name;
  };
}
