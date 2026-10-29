/**
 * The hub's read-only views computed from a room's own log (data/<room>.jsonl): run metrics and RSI-7's four room
 * measurements. Both read the whole log, so they are for a report or an operator's look, never a dashboard poll.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Express, Response } from "express";
import type { Hub } from "../hub.js";
import { embedderFromEnv, measureRoom, renderMeasurements } from "./room.js";
import { gitShaAuthor, parseRoomLog, renderMetrics, roomRepos, runMetrics } from "../run-metrics.js";
import { renderTimeline, runTimeline } from "../run-timeline.js";

export function registerLogRoutes(app: Express, hub: Hub, notFound: (res: Response, e: unknown) => void): void {
  const logOf = (room: string, res: Response) => {
    const r = hub.getRoom(room);
    const file = hub.dataDir ? resolve(hub.dataDir, `${r.name}.jsonl`) : undefined;
    if (!file || !existsSync(file)) { res.status(404).type("text/plain").send("no room log: this hub runs in memory"); return undefined; }
    return { name: r.name, events: parseRoomLog(readFileSync(file, "utf8")) };
  };
  // runs git once per cited commit, synchronously
  app.get("/rooms/:room/metrics", (req, res) => {
    try {
      const log = logOf(req.params.room, res);
      if (!log) return;
      const m = runMetrics(log.events, { shaAuthor: gitShaAuthor(...roomRepos(log.events), process.env.CHATROOM_DEFAULT_CWD, hub.cwd) });
      const timeline = runTimeline(log.events);
      if (req.query.format === "md") res.type("text/markdown").send(renderMetrics(m) + renderTimeline(timeline));
      else res.json({ ...m, timeline });
    } catch (e) {
      notFound(res, e);
    }
  });
  // asynchronous: the embedder is a fetch with its own timeout; CHATROOM_EMBED_URL unset gives "embedder absent" in the two
  // blocks that need it, never a failure (src/measurements/room.ts)
  app.get("/rooms/:room/measurements", async (req, res) => {
    try {
      const log = logOf(req.params.room, res);
      if (!log) return;
      const m = await measureRoom(log.events, log.name, { embedder: embedderFromEnv() });
      if (req.query.format === "md") res.type("text/markdown").send(renderMeasurements([m]));
      else res.json(m);
    } catch (e) {
      notFound(res, e);
    }
  });
}
