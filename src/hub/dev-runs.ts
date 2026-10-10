/**
 * Dev runs the hub starts itself, so a verify head's dev_room is the hub's own record and not the reviewer's word
 * (swarm-082539-kns2, claim/verification; round-1 remaining/verification item 1). Before this, the hub fetched
 * whatever a cited loopback URL served: a static file passed, and the "commit it ran" was the dev hub's own report of
 * its CHATROOM_DEFAULT_CWD. That is SLSA build L1, provenance the tenant writes (sources/slsa-build-levels). Here the
 * platform makes it, which is L2: the hub resolves the commit in its own repo, checks it out detached into a directory
 * it owns, builds it, records what it built (sha256 of the entry points), starts the launcher on a port it picked,
 * watches that dev hub until the launcher exits, keeps a summary of the room, and stops what it started.
 * Not L3: seats run as the same OS user, so one could still edit the hub's data dir. The receipt raises the cost of
 * a forgery from "serve a file" to "tamper with the parent hub's process or log".
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inside, stopStrays } from "../strays.js";

export interface DevRunSummary {
  room: string;
  state?: string;
  agent_seats: number;
  speaking_seats: number;
  messages: number;
  conclusion?: string;
  /** seat-reported spend of the dev room, when the built commit reports usage (live-usage); absent means unknown, not $0 */
  cost_usd?: number;
  read_at: string;
}

export interface DevRun {
  id: string;
  /** the room whose seat asked for it; its log holds this record */
  room: string;
  requested_by: string;
  session?: string;
  commit: string;
  task: string;
  agents: number;
  model: string;
  timeout_min: number;
  port: number;
  dir: string;
  state: "building" | "running" | "ended" | "failed";
  started_at: string;
  pid?: number;
  /** sha256 of what the hub built and ran, read from the tree it checked out itself */
  entry_sha256?: Record<string, string>;
  ended_at?: string;
  exit_code?: number | null;
  error?: string;
  /** every room the dev hub had, as the parent last read it while that hub was its own */
  rooms?: DevRunSummary[];
  /** the dev hub's listening process, pinned the first time the hub saw it run from this run's tree */
  hub_pid?: number;
  /** set once the port answered from another process: nothing read after that is vouched for */
  tampered?: string;
}

export interface DevRunRequest { room: string; requestedBy: string; session?: string; commit: string; task: string; agents?: number; model?: string; timeoutMin?: number }

/** What touches the machine, so tests can stand in for git, tsc and the launcher. */
export interface DevRunHost {
  /** full sha for a ref in repo, or undefined */
  resolveCommit(repo: string, ref: string): string | undefined;
  /** a built tree of sha under dir; returns the tree and the sha256 of its entry points */
  prepare(repo: string, sha: string, dir: string): Promise<{ tree: string; entry_sha256: Record<string, string> }>;
  freePort(from: number, to: number, taken: Set<number>): Promise<number | undefined>;
  launch(r: DevRun, tree: string): { pid?: number; exited: Promise<number | null> };
  fetchJson(url: string): Promise<unknown>;
  /** the process listening on port, and its working directory */
  listener(port: number): { pid: number; cwd?: string } | undefined;
  /** stop every process the run left under its dir (the dev hub, seats' jobs) */
  stop(r: DevRun): Promise<void>;
}

export const DEV_MODELS = (process.env.CHATROOM_DEV_MODELS ?? "claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5").split(",").map((s) => s.trim()).filter(Boolean);
const [PORT_FROM, PORT_TO] = (process.env.CHATROOM_DEV_PORTS ?? "7990-7999").split("-").map(Number);

export class DevRunError extends Error {}

export class DevRuns {
  static MAX_LIVE = Number(process.env.CHATROOM_MAX_DEV_RUNS ?? 2);
  static MAX_AGENTS = 3;
  static MAX_TIMEOUT_MIN = 30;
  static POLL_MS = 15_000;
  readonly runs = new Map<string, DevRun>();
  private seq = 0;

  constructor(
    private readonly opts: {
      repo?: string;
      persist: (r: DevRun) => void;
      announce: (room: string, text: string) => void;
      host?: DevRunHost;
      ports?: [number, number];
    },
  ) {}

  private get host(): DevRunHost { return this.opts.host ?? realHost; }

  live(): DevRun[] { return [...this.runs.values()].filter((r) => r.state === "building" || r.state === "running"); }

  /** Register and start one run; refuses before anything is spawned. Resolves once it is registered, not when it ends. */
  async start(q: DevRunRequest): Promise<DevRun> {
    const repo = this.opts.repo;
    if (!repo) throw new DevRunError("This hub has no project directory (CHATROOM_DEFAULT_CWD), so it cannot build a commit.");
    const model = q.model ?? DEV_MODELS[0];
    if (!DEV_MODELS.includes(model)) throw new DevRunError(`model must be one of ${DEV_MODELS.join(", ")}`);
    const agents = q.agents ?? 3;
    if (!Number.isInteger(agents) || agents < 2 || agents > DevRuns.MAX_AGENTS) throw new DevRunError(`agents must be 2 to ${DevRuns.MAX_AGENTS}: a dev room needs two seats to show agents working together, and this machine is shared`);
    const timeout = q.timeoutMin ?? 15;
    if (!(timeout > 0 && timeout <= DevRuns.MAX_TIMEOUT_MIN)) throw new DevRunError(`timeout_min must be 1 to ${DevRuns.MAX_TIMEOUT_MIN}`);
    if (!q.task.trim()) throw new DevRunError("task is empty: say what the dev room's agents should do with the change");
    const mine = this.live().find((r) => r.requested_by === q.requestedBy || (q.session && r.session === q.session));
    if (mine) throw new DevRunError(`You already have dev run ${mine.id} (${mine.state}); one at a time per seat.`);
    if (this.live().length >= DevRuns.MAX_LIVE) throw new DevRunError(`${DevRuns.MAX_LIVE} dev runs are already live on this hub (CHATROOM_MAX_DEV_RUNS); wait for one to end.`);
    const sha = this.host.resolveCommit(repo, q.commit.trim());
    if (!sha) throw new DevRunError(`"${q.commit}" is not a commit in ${repo}: commit your change and pass its sha.`);
    const [from, to] = this.opts.ports ?? [PORT_FROM, PORT_TO];
    const port = await this.host.freePort(from, to, new Set(this.live().map((r) => r.port)));
    if (!port) throw new DevRunError(`no free port in ${from}-${to} (CHATROOM_DEV_PORTS)`);
    const id = `dr_${Date.now().toString(36)}${(this.seq++).toString(36)}`;
    // realpath: macOS's tmpdir is a symlink, and the stray sweep compares the cwd lsof prints (the real path)
    const dir = realpathSync(mkdtempSync(join(tmpdir(), `devrun-${id}-`)));
    const r: DevRun = {
      id, room: q.room, requested_by: q.requestedBy, ...(q.session ? { session: q.session } : {}), commit: sha, task: q.task.slice(0, 2000),
      agents, model, timeout_min: timeout, port, dir, state: "building", started_at: new Date().toISOString(),
    };
    this.runs.set(id, r);
    this.opts.persist(r);
    void this.run(r, repo);
    return r;
  }

  private async run(r: DevRun, repo: string): Promise<void> {
    try {
      const { tree, entry_sha256 } = await this.host.prepare(repo, r.commit, r.dir);
      r.entry_sha256 = entry_sha256;
      const { pid, exited } = this.host.launch(r, tree);
      r.pid = pid;
      r.state = "running";
      this.opts.persist(r);
      this.opts.announce(r.room, `dev run ${r.id} started by ${r.requested_by}: commit ${r.commit.slice(0, 12)} built by this hub, ${r.agents} ${r.model} seats on port ${r.port}. Its room is http://127.0.0.1:${r.port}/rooms/<room> (dev_run_status names it); cite that as dev_room in a verify head and the hub vouches for the commit and the seats.`);
      let done = false;
      const code = exited.then((c) => { done = true; return c; });
      while (!done) {
        await Promise.race([code, new Promise((res) => setTimeout(res, DevRuns.POLL_MS).unref())]); // never what keeps a hub alive
        await this.observe(r);
      }
      r.exit_code = await code;
      await this.observe(r);
      r.state = "ended";
    } catch (err) {
      r.state = "failed";
      r.error = String((err as Error)?.message ?? err).slice(0, 300);
    }
    r.ended_at = new Date().toISOString();
    await this.host.stop(r).catch(() => {});
    try { this.opts.persist(r); } catch {} // a log that went away must not turn the end of a run into a crash
    const rooms = (r.rooms ?? []).map((x) => `${x.room} ${x.state ?? "?"}, ${x.speaking_seats}/${x.agent_seats} agent seats spoke, ${x.messages} messages${x.cost_usd !== undefined ? `, $${x.cost_usd.toFixed(2)} seat-reported` : ""}`).join("; ");
    try { this.opts.announce(r.room, `dev run ${r.id} (${r.requested_by}, commit ${r.commit.slice(0, 12)}) ${r.state}${r.error ? `: ${r.error}` : ` with exit ${r.exit_code}`}. ${rooms ? `What this hub saw: ${rooms}.` : "No room was seen."} Logs: ${r.dir} (run-data/, run-swarms/)`); } catch {}
  }

  /** Read every room of the dev hub this run owns and keep the summary; quiet on failure (the next poll retries).
   * Only while the listener is the process first seen serving from this run's tree: a seat that kills the dev hub and
   * binds a stub on its port (verifier, attack/idea/hub-launched-dev-runs) freezes the record and marks it. */
  async observe(r: DevRun): Promise<void> {
    if (r.tampered || r.state !== "running") return;
    const l = this.host.listener(r.port);
    if (!l) return;
    if (r.hub_pid === undefined) {
      if (!l.cwd || !inside(l.cwd, r.dir)) return; // not up yet, or someone else's: wait for ours
      r.hub_pid = l.pid;
    } else if (l.pid !== r.hub_pid) {
      r.tampered = `port ${r.port} answered from pid ${l.pid}, not the dev hub this hub saw start (pid ${r.hub_pid})`;
      this.opts.persist(r);
      this.opts.announce(r.room, `dev run ${r.id}: ${r.tampered}. Nothing it serves from now on is vouched for.`);
      return;
    }
    try {
      const list = (await this.host.fetchJson(`http://127.0.0.1:${r.port}/rooms`)) as { name?: string }[] | { rooms?: { name?: string }[] };
      const names = (Array.isArray(list) ? list : list.rooms ?? []).map((x) => x.name).filter((x): x is string => !!x);
      const seen: DevRunSummary[] = [];
      for (const name of names) {
        const b = (await this.host.fetchJson(`http://127.0.0.1:${r.port}/rooms/${encodeURIComponent(name)}`)) as {
          state?: string; message_count?: number; usage?: { cost_usd?: number } | null; conclusion?: { text?: string } | string | null; participants?: { agent?: string; messages?: number; output?: Record<string, number> }[];
        };
        const agents = (b.participants ?? []).filter((x) => x.agent !== "human");
        // a seat that only wrote to the board, challenged or proposed did act: chat alone undercounted (dev run dr_mv254zpq0)
        const concl = typeof b.conclusion === "string" ? b.conclusion : b.conclusion?.text;
        seen.push({ room: name, state: b.state, agent_seats: agents.length, speaking_seats: agents.filter(acted).length, messages: b.message_count ?? 0, ...(concl ? { conclusion: concl.slice(0, 300) } : {}), ...(typeof b.usage?.cost_usd === "number" ? { cost_usd: b.usage.cost_usd } : {}), read_at: new Date().toISOString() });
      }
      if (seen.length) {
        const changed = JSON.stringify(seen.map(({ read_at: _, ...x }) => x)) !== JSON.stringify((r.rooms ?? []).map(({ read_at: _, ...x }) => x));
        r.rooms = seen;
        if (changed) this.opts.persist(r);
      }
    } catch {}
  }

  /** The run that owns the dev hub a URL points at: same port, and live now or the room was seen there by this hub. */
  forUrl(url: URL): DevRun | undefined {
    const port = Number(url.port);
    const room = decodeURIComponent(url.pathname.replace(/^\/rooms\//, ""));
    return [...this.runs.values()].reverse().find((r) => r.port === port && (r.state === "running" || (r.rooms ?? []).some((x) => x.room === room)));
  }

  status(id?: string, requestedBy?: string): DevRun[] {
    return [...this.runs.values()].filter((r) => (id ? r.id === id : !requestedBy || r.requested_by === requestedBy));
  }

  /** Replay: a run the log left building/running died with the hub that watched it. */
  restore(r: DevRun): void {
    this.runs.set(r.id, { ...r, ...(r.state === "building" || r.state === "running" ? { state: "failed", error: "the hub restarted while it ran; nobody watched the rest" } : {}) });
  }
}

/** a seat spoke in chat or put something on the record (board, claim, verify, proposal, challenge) */
export const acted = (x: { messages?: number; output?: Record<string, number> }) =>
  (x.messages ?? 0) > 0 || ["claims", "evidence", "verifies", "proposals", "challenges"].some((k) => (x.output?.[k] ?? 0) > 0);

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** node_modules for a tree outside the project: the main checkout's, found from the shared git dir (worktrees have none). */
function nodeModulesFor(repo: string): string | undefined {
  const common = spawnSync("git", ["-C", repo, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).stdout?.trim();
  for (const c of [join(repo, "node_modules"), common ? join(resolve(common, ".."), "node_modules") : ""]) if (c && existsSync(c)) return c;
  return undefined;
}

export const realHost: DevRunHost = {
  resolveCommit(repo, ref) {
    if (!/^[A-Za-z0-9._/-]{1,200}$/.test(ref) || ref.startsWith("-")) return undefined;
    const r = spawnSync("git", ["-C", repo, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : undefined;
  },
  async prepare(repo, sha, dir) {
    const tree = join(dir, "tree");
    const add = spawnSync("git", ["-C", repo, "worktree", "add", "--detach", tree, sha], { encoding: "utf8" });
    if (add.status !== 0) throw new Error(`git worktree add failed: ${add.stderr.trim().slice(0, 200)}`);
    const nm = nodeModulesFor(repo);
    if (!nm) throw new Error("no node_modules to build with");
    symlinkSync(nm, join(tree, "node_modules"));
    const out = openSync(join(dir, "build.log"), "a");
    const code = await new Promise<number | null>((res) => spawn("npx", ["tsc"], { cwd: tree, stdio: ["ignore", out, out] }).on("exit", res).on("error", () => res(-1)));
    if (code !== 0) throw new Error(`build failed (exit ${code}); see ${join(dir, "build.log")}`);
    const entry_sha256: Record<string, string> = {};
    for (const f of ["dist/index.js", "dist/swarm.js", "dist/hub.js"]) if (existsSync(join(tree, f))) entry_sha256[f] = sha256(join(tree, f));
    return { tree, entry_sha256 };
  },
  async freePort(from, to, taken) {
    for (let p = from; p <= to; p++) {
      if (taken.has(p)) continue;
      const ok = await new Promise<boolean>((res) => {
        const s = createServer().once("error", () => res(false)).once("listening", () => s.close(() => res(true)));
        s.listen(p, "127.0.0.1");
      });
      if (ok) return p;
    }
    return undefined;
  },
  launch(r, tree) {
    const data = join(r.dir, "data");
    mkdirSync(data, { recursive: true });
    const env: NodeJS.ProcessEnv = {};
    // nothing of the parent's hub identity leaks in: its port, data dir and recruit pins are the run's own
    for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("CHATROOM_") && k !== "PORT") env[k] = v;
    Object.assign(env, { CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: data, CHATROOM_RECRUIT_AGENT: "claude", CHATROOM_RECRUIT_MODEL: r.model });
    const out = openSync(join(r.dir, "launcher.log"), "a");
    const args = [join(tree, "dist", "swarm.js"), r.task, "--flat", "--agents", String(r.agents), "--models", r.model, "--verifier-model", r.model, "--timeout", String(r.timeout_min), "--port", String(r.port)];
    const child = spawn(process.execPath, args, { cwd: tree, env, stdio: ["ignore", out, out] });
    const exited = new Promise<number | null>((res) => { child.on("exit", (c) => res(c)); child.on("error", () => res(-1)); });
    return { pid: child.pid, exited };
  },
  async fetchJson(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  listener(port) {
    const pid = Number((spawnSync("lsof", ["-ti", `:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout ?? "").trim().split("\n")[0]);
    if (!pid) return undefined;
    const cwd = (spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" }).stdout ?? "").split("\n").find((x) => x.startsWith("n"))?.slice(1);
    return { pid, ...(cwd ? { cwd } : {}) };
  },
  async stop(r) {
    await stopStrays(r.dir);
    // keep what the run wrote (the room log, the run report), then unregister every worktree under the run dir, the
    // run's tree last: each run left one registered in the project's repo (verifier, verify/hub-launched-dev-runs)
    const tree = join(r.dir, "tree");
    if (!existsSync(tree)) return;
    for (const sub of ["data", "swarms"]) if (existsSync(join(tree, sub))) try { renameSync(join(tree, sub), join(r.dir, `run-${sub}`)); } catch {}
    const listed = spawnSync("git", ["-C", tree, "worktree", "list", "--porcelain"], { encoding: "utf8" }).stdout ?? "";
    const ours = listed.split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9)).filter((p) => inside(p, r.dir));
    for (const p of ours.sort((a, b) => b.length - a.length)) spawnSync("git", ["-C", tree, "worktree", "remove", "--force", p], { encoding: "utf8" });
  },
};
