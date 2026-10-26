/**
 * Reports from a run's launcher that the hub keeps in the room log, as the POST routes the launcher calls (src/swarm.ts):
 * why the run ended (run_end, Hub.recordRunEnd) and what its seats were told was already settled and read (carried,
 * inputs/owner-4: re-research is counted against it, src/telemetry/re-research.ts). A recruit's brief is recorded the same
 * way from the spawner (onTold, src/settled.ts). A carried event writes no line in the room.
 */
import type { Express, Request, Response } from "express";
import type { Hub } from "../hub.js";
import { now } from "../hub/internal.js";
import { HubError } from "../hub/types.js";
import type { RunEndCause } from "../respawn.js";
import { carriedSummary, onTold } from "../settled.js";

/** One carried event: the outside ids in the text the seats were given, how many settled axes it listed, its length. */
export function recordCarried(hub: Hub, roomName: string, from: "launcher" | "spawner", text: string, opts: { seats?: unknown[]; noCarry?: boolean } = {}): { recorded: true; ids: number } {
  const room = hub.getRoom(roomName);
  if (typeof text !== "string") throw new HubError("carried: text must be a string (the settled text the seats were given, empty for none).", undefined, "invalid-arg");
  const { ids, axes, chars } = carriedSummary(text);
  const seats = (opts.seats ?? []).filter((s): s is string => typeof s === "string" && !!s.trim()).map((s) => s.trim().slice(0, 64)).slice(0, 200);
  hub.persist({ type: "carried", room: room.name, from, ...(seats.length ? { seats } : {}), ids, axes, chars, ...(opts.noCarry ? { no_carry: true as const } : {}), ts: now() });
  return { recorded: true, ids: ids.length };
}

/** The launcher's report routes, and the spawner's record of each recruit's brief. */
export function registerLaunchReports(app: Express, hub: Hub, authorize: (req: Request, res: Response) => boolean): void {
  onTold((room, seats, text) => void recordCarried(hub, room, "spawner", text, { seats }));
  const report = (path: string, record: (room: string, body: Record<string, unknown>) => unknown) =>
    app.post(`/rooms/:room/${path}`, (req, res) => {
      if (!authorize(req, res)) return;
      try {
        res.json(record(req.params.room, (req.body ?? {}) as Record<string, unknown>));
      } catch (e) {
        res.status(400).type("text/plain").send(e instanceof HubError ? e.message : "error");
      }
    });
  // Why the run that owns a room ended, from its launcher (concluded, timeout, operator_stop, seats_exited): a run_end
  // event in the room log and one line in the room. A repeat is accepted and ignored: the first stands.
  report("run-end", (room, { cause, detail }) => hub.recordRunEnd(room, cause as RunEndCause, typeof detail === "string" ? detail : undefined));
  // What the launcher told every seat it started (no seats named) or the seats named, posted once per room at launch.
  report("carried", (room, { text, seats, no_carry }) => recordCarried(hub, room, "launcher", text as string, { seats: Array.isArray(seats) ? seats : undefined, noCarry: no_carry === true }));
}
