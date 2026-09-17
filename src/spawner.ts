/**
 * Spawner: lets a member of a room recruit a new agent into the chat.
 * The hub process launches `claude -p` or `codex exec` with a rendered brief
 * that tells the newcomer which room to join and what to do. Caps keep a
 * runaway "spawn more agents" loop from taking the machine down.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, createWriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HubError } from "./hub.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

export interface SpawnRequest {
  room: string;
  brief: string;
  requestedBy: string; // participant name
  name?: string;
  agent?: "claude" | "codex";
  model?: string;
  cwd?: string;
  canEdit?: boolean;
}

export interface SpawnedAgent {
  name: string;
  room: string;
  agent: "claude" | "codex";
  model?: string;
  cwd: string;
  requestedBy: string;
  brief: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  pid?: number;
  log: string;
}

export interface SpawnerOptions {
  mcpUrl: string;
  defaultCwd: string;
  logDir: string;
  maxPerRoom?: number;
  maxLive?: number;
  maxPerRequester?: number;
  /** test hook: record but do not launch */
  dryRun?: boolean;
}

const READ_TOOLS = ["mcp__chatroom__*", "Read", "Grep", "Glob", "Bash", "WebSearch", "WebFetch"];
const WRITE_TOOLS = [...READ_TOOLS, "Edit", "Write", "MultiEdit", "NotebookEdit"];

export class Spawner {
  readonly agents: SpawnedAgent[] = [];
  private readonly children = new Map<string, ChildProcess>();
  private counter = 0;

  constructor(private readonly opts: SpawnerOptions) {
    mkdirSync(opts.logDir, { recursive: true });
  }

  live(room?: string): SpawnedAgent[] {
    return this.agents.filter((a) => a.endedAt === undefined && (!room || a.room === room));
  }

  request(req: SpawnRequest): SpawnedAgent {
    const maxPerRoom = this.opts.maxPerRoom ?? 6;
    const maxLive = this.opts.maxLive ?? 20;
    const maxPerRequester = this.opts.maxPerRequester ?? 3;
    if (req.brief.trim().length < 20 || req.brief.length > 4000) throw new HubError("A brief of 20-4000 characters is required: say what to do and what done looks like.");
    if (this.live().length >= maxLive) throw new HubError(`Spawn cap reached: ${maxLive} recruited agents are already running. Wait for one to finish.`);
    if (this.live(req.room).length >= maxPerRoom) throw new HubError(`Room cap reached: ${maxPerRoom} recruited agents are already active in "${req.room}".`);
    const mine = this.agents.filter((a) => a.requestedBy === req.requestedBy && a.endedAt === undefined).length;
    if (mine >= maxPerRequester) throw new HubError(`You already have ${maxPerRequester} recruited agents running. Wait for one to finish or ask a teammate to recruit.`);

    const agent = req.agent ?? "claude";
    const name = (req.name?.trim() || `${agent}-recruit-${++this.counter}`).replace(/[^\w-]/g, "-").slice(0, 40);
    if (this.agents.some((a) => a.name === name && a.endedAt === undefined)) throw new HubError(`An agent named "${name}" is already running; pick another name.`);
    const cwd = resolve(req.cwd ?? this.opts.defaultCwd);
    const log = resolve(this.opts.logDir, `${name}.log`);
    const rec: SpawnedAgent = { name, room: req.room, agent, model: req.model, cwd, requestedBy: req.requestedBy, brief: req.brief, startedAt: new Date().toISOString(), log };
    this.agents.push(rec);

    const prompt = readFileSync(resolve(repoRoot, "prompts", "recruit.md"), "utf8")
      .split("{{NAME}}").join(name)
      .split("{{ROOM}}").join(req.room)
      .split("{{BY}}").join(req.requestedBy)
      .split("{{BRIEF}}").join(req.brief)
      .split("{{CWD}}").join(cwd)
      .split("{{AGENT}}").join(agent)
      .split("{{WRITE_RULE}}").join(req.canEdit ? "You MAY edit files and run anything here; if you change code, do it on your own git worktree/branch and say which." : "Do NOT modify files; investigate and report.");

    if (this.opts.dryRun) {
      writeFileSync(log, `[dry-run] would launch ${agent} in ${cwd}\n\n${prompt}`);
      rec.endedAt = new Date().toISOString();
      rec.exitCode = 0;
      return rec;
    }

    const mcpJson = resolve(this.opts.logDir, "mcp.json");
    writeFileSync(mcpJson, JSON.stringify({ mcpServers: { chatroom: { type: "http", url: this.opts.mcpUrl } } }));
    let cmd: string;
    let args: string[];
    if (agent === "codex") {
      cmd = "codex";
      args = ["exec", "--skip-git-repo-check", "-C", cwd, "-c", `mcp_servers.chatroom.url="${this.opts.mcpUrl}"`, "-c", "mcp_servers.chatroom.tool_timeout_sec=120"];
      if (req.model) args.push("-m", req.model);
      args.push(prompt);
    } else {
      cmd = "claude";
      args = ["-p", prompt, "--mcp-config", mcpJson, "--strict-mcp-config", "--allowedTools", (req.canEdit ? WRITE_TOOLS : READ_TOOLS).join(",")];
      if (req.model) args.push("--model", req.model);
    }
    const out = createWriteStream(log);
    const child = spawn(cmd, args, { cwd, env: { ...process.env, MCP_TOOL_TIMEOUT: "120000" }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.pipe(out);
    child.stderr?.pipe(out);
    rec.pid = child.pid;
    this.children.set(name, child);
    child.on("close", (code) => {
      rec.endedAt = new Date().toISOString();
      rec.exitCode = code;
      this.children.delete(name);
    });
    return rec;
  }

  stop(name: string): boolean {
    const c = this.children.get(name);
    if (!c) return false;
    c.kill();
    return true;
  }

  stopAll(): void {
    for (const c of this.children.values()) c.kill();
  }
}
