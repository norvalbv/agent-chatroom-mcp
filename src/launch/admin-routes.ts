import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type express from "express";
import { Hub, HubError } from "../hub.js";
import type { RecruitPolicy, Spawner } from "../spawner.js";

/**
 * What the owner does from the dashboard that used to need a terminal: start a run (the launcher, dist/swarm.js, the same
 * command a shell would run), stop it, add a seat to a live room, hold a room's decision, and the recruit policy and
 * hub-spawned agents (moved here from index.ts). Starting a run or a recruit spends money and acts on other agents, so
 * both need the human token even on loopback, as /policy and /agents/:name/stop always have. A custom header also makes
 * a browser preflight the request, so another web page cannot fire one.
 */
type Guard = (req: express.Request, res: express.Response) => boolean;
export interface AdminDeps {
  hub: Hub;
  spawner: Spawner;
  port: number;
  /** where each run's launcher log and runs.json live (logs/ui-runs) */
  runDir: string;
  defaultCwd: string;
  requireToken: Guard;
  requireAgentControl: Guard;
  /** the launcher to start; tests pass a stub. Default: node <checkout>/dist/swarm.js, detached, so a hub restart does not end the run */
  launch?: (args: string[], o: { cwd: string; log: string; env: NodeJS.ProcessEnv }) => { pid?: number };
}

export interface UiRun { id: string; pid?: number; task: string; cwd: string; args: string[]; by: string; started_at: string; log: string; run_id?: string; stopped_at?: string }

/** Models the form offers (Claude only: memory recruits-claude-only); any id the launcher accepts may be typed. */
export const RUN_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
const MODEL_ID = /^[a-z0-9][a-z0-9.:/_-]{0,80}$/i;
const RUN_ID = /\b(swarm-\d{6}-[a-z0-9]{4})\b/;
const head = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const alive = (pid?: number) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };

/** The launcher prints `swarm <id>: …` once it has started (src/swarm.ts); its rooms are named after the id. */
function sniffRunId(log: string): string | undefined {
  try {
    const fd = openSync(log, "r"), size = statSync(log).size, buf = Buffer.alloc(Math.min(size, 16_384));
    readSync(fd, buf, 0, buf.length, 0); closeSync(fd);
    return RUN_ID.exec(buf.toString("utf8"))?.[1];
  } catch { return undefined; }
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
function defaultLaunch(args: string[], o: { cwd: string; log: string; env: NodeJS.ProcessEnv }) {
  const out = openSync(o.log, "a");
  const child = spawn(process.execPath, [join(ROOT, "dist", "swarm.js"), ...args], { cwd: o.cwd, env: o.env, detached: true, stdio: ["ignore", out, out] });
  child.unref(); closeSync(out);
  return { pid: child.pid };
}

/** CHATROOM_SPAWN_DRY=1 (smoke, tests): nothing is started; the log says what would have been, under a run id. */
function dryLaunch(args: string[], o: { log: string }) {
  writeFileSync(o.log, `swarm swarm-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}-dry0: dry run (CHATROOM_SPAWN_DRY=1): ${JSON.stringify(args)}\n`);
  return { pid: undefined };
}

/** The launcher's arguments for a dashboard run: one flat room, its seats on the models asked, a verifier, this hub. */
export function runArgs(b: Record<string, unknown>, o: { port: number; defaultCwd: string; maxAgents: number }): { task: string; cwd: string; args: string[] } {
  const task = typeof b.task === "string" ? b.task.trim() : "";
  if (task.length < 20 || task.length > 20_000) throw new HubError("The brief is 20 to 20,000 characters: what the room should do and what done looks like.", undefined, "invalid-arg");
  if (task.startsWith("-")) throw new HubError("The brief cannot start with '-': the launcher would read it as a flag.", undefined, "invalid-arg");
  const cwd = typeof b.cwd === "string" && b.cwd.trim() ? b.cwd.trim() : o.defaultCwd;
  if (!isAbsolute(cwd) || !existsSync(cwd) || !statSync(cwd).isDirectory()) throw new HubError(`Project folder ${cwd} is not an existing absolute directory.`, undefined, "invalid-arg");
  const agents = b.agents === undefined ? 4 : Number(b.agents);
  if (!Number.isInteger(agents) || agents < 2 || agents > o.maxAgents) throw new HubError(`Seats is 2 to ${o.maxAgents} (one of them is the verifier).`, undefined, "invalid-arg");
  const minutes = b.timeout_min === undefined ? 120 : Number(b.timeout_min);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 720) throw new HubError("Minutes is 5 to 720: the launcher stops every seat then.", undefined, "invalid-arg");
  const model = typeof b.model === "string" && b.model ? b.model : RUN_MODELS[0];
  const verifier = typeof b.verifier_model === "string" && b.verifier_model ? b.verifier_model : model;
  for (const m of model.split(",").concat(verifier)) if (!MODEL_ID.test(m)) throw new HubError(`"${m}" is not a model id.`, undefined, "invalid-arg");
  const args = [task, "--flat", "--agents", String(agents), "--models", model, "--verifier-model", verifier, "--timeout", String(minutes), "--port", String(o.port), "--cwd", cwd];
  if (b.full_access === true) args.push("--full-access");
  if (b.require_verification === true) args.push("--require-verification");
  return { task, cwd, args };
}

export function registerAdminRoutes(app: express.Express, d: AdminDeps) {
  const { hub, spawner } = d;
  const file = join(d.runDir, "runs.json");
  let runs: UiRun[] = [];
  try { runs = JSON.parse(readFileSync(file, "utf8")); } catch {}
  const save = () => { try { mkdirSync(d.runDir, { recursive: true }); writeFileSync(file, JSON.stringify(runs.slice(-50), null, 1)); } catch {} };
  const view = (r: UiRun) => {
    r.run_id ??= sniffRunId(r.log);
    const rooms = r.run_id ? hub.listRooms(false, true).filter((x) => x.name.startsWith(`${r.run_id}-`)).map((x) => ({ name: x.name, state: x.state })) : [];
    return { id: r.id, run_id: r.run_id ?? null, task: head(r.task, 240), cwd: r.cwd, by: r.by, started_at: r.started_at, stopped_at: r.stopped_at ?? null, running: alive(r.pid), pid: r.pid ?? null, rooms, log: r.log };
  };
  const fail = (res: express.Response, e: unknown) => res.status(400).type("text/plain").send(e instanceof HubError ? e.message : e instanceof Error ? e.message : "error");
  const asHuman = (room: string, name: unknown) => hub.join(room, (typeof name === "string" && name.trim() ? name : "human").trim().slice(0, 64), "human", {}, undefined, `http:${name || "human"}`).participant;

  // ---- runs: the dashboard's "New room" ----
  app.get("/runs", (_req, res) => res.json({ runs: runs.slice().reverse().map(view), models: RUN_MODELS, default_cwd: d.defaultCwd, max_agents: Hub.MAX_LIVE_PER_ROOM }));
  app.post("/runs", (req, res) => {
    if (!d.requireAgentControl(req, res)) return;
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const { task, cwd, args } = runArgs(b, { port: d.port, defaultCwd: d.defaultCwd, maxAgents: Hub.MAX_LIVE_PER_ROOM });
      mkdirSync(d.runDir, { recursive: true });
      const id = `ui-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
      const log = join(d.runDir, `${id}.log`);
      // the hub's own environment minus its human token: the launcher speaks with the launcher token (logs/hub-<port>-token)
      const env = { ...process.env };
      delete env.CHATROOM_HUMAN_TOKEN;
      const { pid } = (d.launch ?? (process.env.CHATROOM_SPAWN_DRY === "1" ? dryLaunch : defaultLaunch))(args, { cwd, log, env });
      const run: UiRun = { id, pid, task, cwd, args, by: typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 64) : "human", started_at: new Date().toISOString(), log };
      runs.push(run); save();
      console.error(`ui run ${id}: pid=${pid} cwd=${cwd} ${args.slice(1).join(" ")}`);
      res.status(201).json(view(run));
    } catch (e) { fail(res, e); }
  });
  app.post("/runs/:id/stop", (req, res) => {
    if (!d.requireAgentControl(req, res)) return;
    const r = runs.find((x) => x.id === req.params.id);
    if (!r) return void res.status(404).type("text/plain").send("no run with that id was started from this hub");
    // SIGTERM: the launcher posts run-end operator_stop to its rooms and stops its seats (src/swarm.ts)
    if (r.pid && alive(r.pid)) try { process.kill(r.pid, "SIGTERM"); } catch (e) { return fail(res, e); }
    r.stopped_at = new Date().toISOString(); save();
    res.json(view(r));
  });

  // ---- a seat added to a live room by the owner: request_agent's spawn, with the human as requester ----
  app.get("/rooms/:room/recruitment", (req, res) => {
    try { hub.getRoom(req.params.room); res.json({ ...spawner.recruitmentStatus(req.params.room, undefined, true), models: RUN_MODELS }); } catch (e) { res.status(404).type("text/plain").send(e instanceof HubError ? e.message : "error"); }
  });
  app.post("/rooms/:room/recruit", (req, res) => {
    if (!d.requireAgentControl(req, res)) return;
    try {
      const b = (req.body ?? {}) as { name?: string; brief?: string; seat_name?: string; model?: string; count?: number; can_edit?: boolean; cwd?: string; area?: string };
      const brief = String(b.brief ?? "").trim();
      if (brief.length < 20 || brief.length > 4000) throw new HubError("The brief is 20 to 4,000 characters.", undefined, "invalid-arg");
      if (b.model && !MODEL_ID.test(b.model)) throw new HubError(`"${b.model}" is not a model id.`, undefined, "invalid-arg");
      if (b.cwd && (!isAbsolute(b.cwd) || !existsSync(b.cwd))) throw new HubError(`${b.cwd} is not an existing absolute directory.`, undefined, "invalid-arg");
      const r = hub.getRoom(req.params.room);
      if (r.state !== "open") throw new HubError(`${r.name} is ${r.state}: a seat can only join an open room.`, undefined, "state");
      const me = asHuman(r.name, b.name);
      const recs = spawner.request({ room: r.name, brief, requestedBy: me.name, requestedByShown: hub.shown(r, me), parentTopic: r.topic, name: b.seat_name?.trim() || undefined, agent: b.model ? "claude" : undefined, model: b.model || undefined, owner: !!b.model, cwd: b.cwd || undefined, canEdit: b.can_edit === true, count: Math.min(3, Math.max(1, Number(b.count) || 1)), area: b.area?.trim() || undefined });
      hub.announce(r.name, `${hub.shown(r, me)} added ${recs.map((x) => x.name).join(", ")} from the dashboard (${recs[0].agent}${recs[0].model ? `/${recs[0].model}` : ""}${b.can_edit ? ", can edit" : ""}): ${head(brief, 200)}`);
      // telemetry: what the owner did by hand, apart from what seats did (an announce is prose; this is countable)
      hub.persist({ type: "owner_action", room: r.name, action: "recruit", by: me.name, spawned: recs.map((x) => x.name), agent: recs[0].agent, model: recs[0].model ?? null, picked: b.model || null, can_edit: b.can_edit === true, ts: new Date().toISOString() });
      res.status(201).json({ spawned: recs.map((x) => x.name), agent: recs[0].agent, model: recs[0].model ?? null, logs: recs.map((x) => x.log) });
    } catch (e) { fail(res, e); }
  });

  // ---- hold a room's decision: hold/<room> on its board, written as the human (it blocks a conclusion and recruiting) ----
  app.post("/rooms/:room/hold", (req, res) => {
    if (!d.requireToken(req, res)) return;
    try {
      const { name, hold, reason } = (req.body ?? {}) as { name?: string; hold?: boolean; reason?: string };
      const r = hub.getRoom(req.params.room), me = asHuman(r.name, name);
      hub.setBoard(r.name, me.id, `hold/${r.name}`, hold === false ? "" : `${me.name} holds the decision from the dashboard${reason ? `: ${reason}` : ""}. Keep working; do not conclude until this is cleared.`);
      hub.persist({ type: "owner_action", room: r.name, action: hold === false ? "release" : "hold", by: me.name, ts: new Date().toISOString() });
      res.json({ room: r.name, held: !!hub.hold(r) });
    } catch (e) { fail(res, e); }
  });

  // ---- recruit policy and hub-spawned agents (were in index.ts) ----
  app.get("/policy", (_req, res) => res.json({ recruits: spawner.policy }));
  app.post("/policy", (req, res) => {
    if (!d.requireAgentControl(req, res)) return;
    const b = (req.body ?? {}) as { agent?: string | null; model?: string | null };
    const agent = b.agent === null || b.agent === "any" || b.agent === "" ? undefined : b.agent;
    if (agent && !["claude", "codex", "openrouter"].includes(agent)) return void res.status(400).type("text/plain").send("agent must be claude, codex, openrouter or any");
    spawner.policy = { agent: agent as RecruitPolicy["agent"], model: b.model === null || b.model === "any" || b.model === "" ? undefined : b.model ?? undefined };
    res.json({ recruits: spawner.policy });
  });
  app.get("/agents", (_req, res) => res.json(spawner.agents.map((a) => ({ ...a, brief: a.brief.slice(0, 300) }))));
  app.post("/agents/:name/stop", (req, res) => {
    if (!d.requireAgentControl(req, res)) return;
    res.json({ stopped: spawner.stop(req.params.name) });
  });
}

/** A write from another web page: a browser sends its Origin, and under CHATROOM_INSECURE_LOCAL a body-less POST such as
 * /rooms/:room/close needed nothing else. curl and the seats send no Origin; the dashboard sends its own. */
export function sameOriginWrites(req: express.Request, res: express.Response, next: express.NextFunction) {
  const origin = req.header("origin");
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS" || !origin || req.path.startsWith("/mcp")) return next(); // /mcp: the SDK checks its own Host
  let host: string | undefined;
  try { host = new URL(origin).host; } catch {}
  if (host && host === req.header("host")) return next();
  res.status(403).type("text/plain").send("refused: a write from another site's page");
}
