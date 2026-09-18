/**
 * A seat: one process, one agent, one MCP session (identity-is-the-connection) for models that have
 * no agentic CLI of their own. Everything provider-independent lives here: the local project tools,
 * the hub tools bridged over MCP with their full descriptions and the hub's instructions, the system
 * prompt, the step loop, context trimming, the wall-clock budget, and leaving the room on the way out.
 * A provider (src/openrouter.ts, or a future direct-API one) only implements `ChatProvider.complete`.
 *
 * Parity target: what `claude -p` and `codex exec` give a model for free. The differences that hurt a
 * weaker model are handled here rather than left to its prompt: the hub's `hint` is repeated as a user
 * turn when it is about this seat, reasoning blocks are passed back so tool use stays coherent, and
 * the seat leaves the room (instead of vanishing) when its budget or a provider error ends it.
 */
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// ---------- wire types (OpenAI chat-completions shape, snake_case as providers send it) ----------
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export type Msg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[]; reasoning_details?: unknown[] }
  | { role: "tool"; tool_call_id: string; content: string };
export interface ToolDef {
  type: "function";
  function: { name: string; description?: string; parameters: Record<string, unknown> };
}
export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  cost: number;
}
/** One model turn as the loop consumes it. `reasoningDetails` is passed back verbatim on the next request. */
export interface Reply {
  content: string;
  toolCalls: ToolCall[];
  reasoningDetails?: unknown[];
  usage?: Partial<Usage>;
}
export interface ChatProvider {
  /** shown in logs, e.g. "openrouter deepseek/deepseek-v4.1-flash" */
  label: string;
  complete(messages: Msg[], tools: ToolDef[]): Promise<Reply>;
}

export interface SeatOptions {
  prompt: string;
  mcpUrl?: string;
  cwd: string;
  /** may modify files and run mutating commands */
  write?: boolean;
  /** offer run_command (default true) */
  shell?: boolean;
  /** wall-clock budget; the seat leaves its rooms and stops when it runs out (default 45) */
  maxMinutes?: number;
  /** safety cap on model turns, not a pacing device (default 600) */
  maxSteps?: number;
  /** clamp on a local tool result (default 6000); hub results get five times this */
  maxToolChars?: number;
  /** transcript size before the oldest turns are dropped (default 240000) */
  maxContextChars?: number;
  /** how many empty wait_for_messages results to absorb locally before spending a model turn (default 3): idle polling is most of a seat's provider requests */
  idleWaits?: number;
  /**
   * Cache-stable trimming (default off: legacy per-step FIFO trim back to the ceiling). When on, a trim
   * still triggers at maxContextChars but drops down to a lower floor in one shot and marks the drop with
   * a single checkpoint message, so trimming fires as an infrequent, periodic checkpoint instead of on
   * roughly every other step — the transcript grows append-only (and so keeps a stable, cacheable prefix)
   * between checkpoints, rather than invalidating the provider's prompt cache almost every turn.
   */
  checkpointTrim?: boolean;
  log?: (line: string) => void;
}
export interface SeatResult {
  final: string;
  usage: Usage;
  steps: number;
  /** false when a provider error ended the run */
  ok: boolean;
}

/** Tool result shape we look at for hints; everything else is passed through untouched. */
interface HubView {
  hint?: string;
  messages?: unknown[];
  room_state?: string;
  addressed_to_you?: unknown[];
  unanswered_human?: { you_answer?: boolean } | null;
  open_proposal?: unknown;
}

// ---------- local tools: the project, read-only unless write ----------
/**
 * Not a sandbox: the CLI seats get a real shell too and the write rule lives in the prompt. This
 * only stops a read-only seat from mutating the checkout by accident, which weaker models do.
 */
const MUTATING = /(^|[;&|]\s*)(rm|mv|cp|chmod|chown|truncate|dd|kill|pkill|shutdown)\s|sed\s+-i|tee\s|(?<![0-9])>>?\s*(?!\/dev\/null)[^&|]|git\s+(?!stash (list|show)|clean -n|apply --check)(commit|checkout|reset|clean|push|rebase|merge|stash|apply|restore)|npm\s+(i|install|uninstall|publish)|(yarn|pnpm|pip|brew|cargo)\s+(add|install|remove)/;
/**
 * Always on, even with write access: a seat shares the machine with the hub, its siblings and the launcher,
 * all of them node processes. A pattern kill takes the whole swarm down (it did, once). Kill by pid only.
 */
const LETHAL = /(^|[;&|]\s*)(pkill|killall)\b|kill\s+(-\w+\s+)*(-1|0)\b|kill\s+--\s+-|kill\s+-9\s+-1/;
/**
 * Always on, even with write access. `git config` writes the repository config (with --global,
 * the machine's) that every git worktree of the same checkout reads. Seats are authored by
 * GIT_AUTHOR_NAME/GIT_COMMITTER_NAME at launch, never by git config; one seat renamed every commit
 * author for an hour (docs/measurement-swarm-214936.md:5).
 */
// any form: git config ... , and git with global flags before config (git --no-pager config,
// git -c k=v config), which the plain `git config` pattern would miss. Generalized per
// openrouter-recruit-14's review.
const GITCONFIG = /(^|[;&|]\s*)git(\s+-[^\s]+(\s+[^\s]+)?)*\s+config\b/;
/** A `>` inside quotes writes nothing, so the guard above is tested against the unquoted text. */
const unquoted = (command: string) => command.replace(/'[^']*'|"[^"]*"/g, '""');

type LocalTool = { def: ToolDef; run: (a: Record<string, string>) => string | Promise<string> };

export function localTools(cwd: string, write: boolean, shell: boolean, clamp: (s: string) => string): LocalTool[] {
  const inside = (p: string) => {
    const abs = resolve(cwd, p);
    if (abs !== cwd && !abs.startsWith(`${cwd}/`)) throw new Error(`${p} is outside the working directory ${cwd}`);
    return abs;
  };
  const sh = (command: string) =>
    new Promise<string>((res) => {
      const child = spawn("bash", ["-lc", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      const timer = setTimeout(() => child.kill(), 120_000);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("close", (code) => {
        clearTimeout(timer);
        res(clamp(`exit ${code}\n${out.trim() || "(no output)"}`));
      });
    });
  const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolDef => ({
    type: "function",
    function: { name, description, parameters: { type: "object", properties, required } },
  });

  const tools: LocalTool[] = [
    {
      def: fn("read_file", "Read a UTF-8 file in the working directory. Returns numbered lines.", { path: { type: "string" }, start: { type: "integer", description: "1-based first line (default 1)" }, limit: { type: "integer", description: "how many lines (default 400)" } }, ["path"]),
      run: (a) => {
        const start = Math.max(1, Number(a.start ?? 1));
        const limit = Math.max(1, Number(a.limit ?? 400));
        const lines = readFileSync(inside(a.path), "utf8").split("\n");
        return clamp(
          lines
            .slice(start - 1, start - 1 + limit)
            .map((l, i) => `${start + i}\t${l}`)
            .join("\n") || "(empty)",
        );
      },
    },
    {
      def: fn("list_dir", "List a directory in the working directory.", { path: { type: "string", description: "default '.'" } }),
      run: (a) => {
        const dir = inside(a.path ?? ".");
        return clamp(
          readdirSync(dir)
            .filter((f) => f !== "node_modules" && f !== ".git")
            .map((f) => {
              try {
                return statSync(resolve(dir, f)).isDirectory() ? `${f}/` : f;
              } catch {
                return f;
              }
            })
            .join("\n") || "(empty)",
        );
      },
    },
    {
      def: fn("search", "Search file contents under the working directory (grep -rn, node_modules and .git excluded).", { pattern: { type: "string" }, path: { type: "string", description: "default '.'" } }, ["pattern"]),
      run: (a) =>
        new Promise<string>((res) => {
          const child = spawn("grep", ["-rnI", "--exclude-dir=node_modules", "--exclude-dir=.git", "--exclude-dir=dist", "-e", a.pattern, relative(cwd, inside(a.path ?? ".")) || "."], { cwd, stdio: ["ignore", "pipe", "pipe"] });
          let out = "";
          let err = "";
          let settled = false;
          const finish = (text: string) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            res(clamp(text));
          };
          const failure = (reason: string, detail = err) =>
            finish(`ERROR: search failed (${reason})${detail.trim() ? `: ${detail.trim().slice(0, 200)}` : ""}`);
          const timer = setTimeout(() => {
            failure("timeout after 60000ms");
            child.kill("SIGKILL");
          }, 60_000);
          child.stdout.on("data", (d) => { if (!settled) out += d; });
          // Drain all stderr, but retain only a bounded diagnostic.
          child.stderr.on("data", (d) => { if (!settled) err = (err + d).slice(0, 200); });
          child.on("error", (error) => failure("spawn", error.message));
          child.on("close", (code, signal) => {
            if (signal) failure(`signal ${signal}`);
            else if (code === 0) finish(out.trim() || "(no output)");
            else if (code === 1) finish("(no matches)");
            else failure(`exit ${code}`);
          });
        }),
    },
    {
      def: fn("web_fetch", "Fetch a public http(s) URL and return its text (HTML tags stripped, 30s limit). Use for documentation, papers and references you cite.", { url: { type: "string" } }, ["url"]),
      run: async (a) => {
        const url = new URL(a.url);
        if (!/^https?:$/.test(url.protocol)) throw new Error("only http(s) URLs");
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "agent-chatroom-seat/0.2 (+https://github.com/norvalbv/agent-chatroom-mcp)" } });
        const raw = await res.text();
        const text = /html/i.test(res.headers.get("content-type") ?? "")
          ? raw
              .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
              .replace(/<[^>]+>/g, " ")
              .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " })[m] ?? m)
              .replace(/[ \t]+/g, " ")
              .replace(/\n\s*\n+/g, "\n")
          : raw;
        return clamp(`HTTP ${res.status}\n${text.trim() || "(empty)"}`);
      },
    },
  ];
  if (shell)
    tools.push({
      def: fn("run_command", `Run a bash command in ${cwd} (120s limit). ${write ? "You may modify files and commit." : "Read-only: mutating commands are refused."} Never run git config: every worktree shares the repository config. Never pkill/killall: other agents and the hub are node processes here; stop a process you started by its pid (kill $(lsof -ti:PORT)).`, { command: { type: "string" } }, ["command"]),
      run: (a) =>
        LETHAL.test(unquoted(a.command))
          ? `Refused: "${a.command.slice(0, 120)}" was not run. pkill, killall and kill -1/0 would take down the hub, the other seats and the launcher, which are node processes on this machine too. Stop only what you started, by pid: kill $(lsof -ti:PORT) for a hub you started on PORT.`
          : GITCONFIG.test(unquoted(a.command))
            ? `Refused: "${a.command.slice(0, 120)}" was not run. git config writes the repository config that every worktree of this checkout shares (one seat renamed every commit author for an hour). Seat identity comes from GIT_AUTHOR_NAME/GIT_COMMITTER_NAME env, never git config; ask the launcher to set those instead.`
            : !write && MUTATING.test(unquoted(a.command))
              ? `Refused: this seat is read-only, so "${a.command.slice(0, 120)}" was not run. Investigate and report instead.`
              : sh(a.command),
    });
  return tools;
}

/** Providers differ on which JSON Schema keywords they tolerate; strip the ones nothing needs. */
export const cleanSchema = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(cleanSchema);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === "$schema" || k === "additionalProperties") continue;
      out[k] = cleanSchema(val);
    }
    return out;
  }
  return v;
};

/**
 * What an agentic CLI would have told the model about itself and the chatroom. The hub's own
 * instructions (the same text Claude Code and Codex inject) come first; the rest is the loop a
 * weaker model tends to get wrong: act on the hint, answer when addressed, leave instead of vanishing.
 */
export function systemPrompt(cwd: string, hubInstructions: string | undefined, write: boolean, shell: boolean): string {
  const local = ["read_file", "list_dir", "search", "web_fetch", ...(shell ? ["run_command"] : [])].join(", ");
  return [
    `You are an autonomous AI agent holding a seat in a shared chatroom with other AI agents (and sometimes a human), working in ${cwd}. Nobody is at the keyboard: never ask the user anything, act with tools, and keep going until your brief is done.`,
    hubInstructions ? `About the chatroom, from the hub: ${hubInstructions}` : "",
    "How to work here:",
    "- Do what your brief says, in order: join the room it names, then submit_opening if the room uses openings, then loop on wait_for_messages (timeout_ms at most 55000) and act on what comes back. An empty wait is normal; call it again.",
    "- Every wait_for_messages result ends with a `hint` and lists `addressed_to_you`. Do what the hint says before waiting again: reply when someone addresses you (send_message with reply_to), answer a human first, vote when a proposal needs your vote, challenge when it needs a challenge. If you have nothing to add, call pass; do not go quiet.",
    "- Read tool results. When the hub refuses a call it says why and what to do instead; do that, do not repeat the same call.",
    "- Talk like a colleague: short messages, one claim and one reason each, plain prose. Put evidence and drafts on the board (board_set) rather than in chat. Openings are capped at 400 characters.",
    "- Every public message is pushed to every seat in the room. A working exchange with one or two agents goes quiet: send_message with quiet=true and their @names (it stays in the log; it is not pushed to everyone). The public channel is for claims, evidence pointers, proposals, challenges and votes.",
    "- Cite only what you fetched in this session: web_fetch the abstract (export.arxiv.org/api/query?search_query=...) and put what it shows on the board under sources/<arxiv-id> before citing it. A remembered paper is not evidence.",
    "- Do not agree to be agreeable; disagree with a specific change. Do not re-propose: amend the open proposal in place.",
    `- Leave with leave_room(reason=what you finished, where it is on the board, what is undone) when the room has concluded or closed, or when your brief says to; then reply with one final message and no tool calls. Local tools on this machine: ${local}${write ? " (you may modify files)" : " (read-only)"}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Every hint but the idle one is an instruction to this seat: those are worth a user turn. */
function actionable(view: HubView): boolean {
  return !!view.hint && !view.hint.startsWith("No new messages");
}

export async function runSeat(provider: ChatProvider, opts: SeatOptions): Promise<SeatResult> {
  const cwd = resolve(opts.cwd);
  const write = opts.write ?? false;
  const shell = opts.shell ?? true;
  const maxMinutes = opts.maxMinutes ?? 45;
  const maxSteps = opts.maxSteps ?? 600;
  const maxToolChars = opts.maxToolChars ?? 6000;
  const maxContextChars = opts.maxContextChars ?? 240_000;
  const idleWaits = Math.max(1, opts.idleWaits ?? 3);
  const checkpointTrim = opts.checkpointTrim ?? false;
  const log = opts.log ?? ((s: string) => process.stderr.write(`${s}\n`));
  const clampTo = (n: number) => (s: string) => (s.length > n ? `${s.slice(0, n)}\n…[truncated, ${s.length} chars total]` : s);
  const clampLocal = clampTo(maxToolChars);
  // hub results carry the proposal text and end with the hint; a clamp that eats the hint is worse than a long result
  const clampHub = clampTo(maxToolChars * 5);

  const local = localTools(cwd, write, shell, clampLocal);
  const tools: ToolDef[] = local.map((t) => t.def);
  const hubTools = new Set<string>();
  const client = new Client({ name: "seat", version: "0.2.0" });
  let instructions: string | undefined;
  if (opts.mcpUrl) {
    await client.connect(new StreamableHTTPClientTransport(new URL(opts.mcpUrl)));
    instructions = client.getInstructions();
    for (const t of (await client.listTools()).tools) {
      hubTools.add(t.name);
      const schema = (cleanSchema(t.inputSchema) ?? {}) as Record<string, unknown>;
      if (!schema.type) schema.type = "object";
      if (!schema.properties) schema.properties = {};
      // full descriptions: they are the guidance; a model that never sees them cannot follow them
      tools.push({ type: "function", function: { name: t.name, description: t.description, parameters: schema } });
    }
    log(`[${provider.label}] ${hubTools.size} hub tools + ${local.length} local tools; budget ${maxMinutes} min`);
  } else {
    log(`[${provider.label}] no MCP url: running with local tools only`);
  }

  const joined = new Set<string>();
  /** participant id per room, from join_room's result, so the seat can heartbeat over HTTP without a room turn */
  const pids = new Map<string, string>();
  const hubBase = opts.mcpUrl?.replace(/\/mcp\/?$/, "");
  let stepNo = 0;
  /** Fire-and-forget: local work makes no hub calls, so this is how the room can tell a busy seat from a dead one. */
  /** What to show a human watching: the command, the path, the pattern, the URL, or the room call's gist. */
  const detailOf = (tool: string, args: Record<string, string>): string => {
    for (const k of ["command", "path", "pattern", "url", "key"]) if (args[k]) return String(args[k]);
    if (tool === "send_message") return String(args.content ?? "").slice(0, 120);
    if (tool === "wait_for_messages") return `timeout ${args.timeout_ms ?? "?"}ms`;
    return "";
  };
  function heartbeat(tool: string, args: Record<string, string> = {}) {
    if (!hubBase) return;
    const detail = String(detailOf(tool, args)).slice(0, 300);
    for (const room of joined) {
      const pid = pids.get(room);
      if (!pid) continue;
      fetch(`${hubBase}/rooms/${encodeURIComponent(room)}/heartbeat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participant_id: pid, tool, step: stepNo, detail }), signal: AbortSignal.timeout(5_000) }).catch(() => {});
    }
  }
  /** What the model must not forget when older turns are dropped: its rooms, names and participant ids. */
  const identityCard = () => (joined.size ? `\n\nYOU ARE ALREADY IN: ${[...joined].map((r) => `room "${r}" as ${joinedAs.get(r) ?? "?"}${pids.get(r) ? ` (participant_id ${pids.get(r)})` : ""}`).join("; ")}. Do not call join_room for these rooms again and never join under another name; continue with wait_for_messages, read_messages, send_message, board_get.` : "");
  const joinedAs = new Map<string, string>();
  async function callTool(name: string, args: Record<string, string>): Promise<string> {
    if (name === "join_room" && args.room && joined.has(args.room)) {
      // the seat knows it is one model: a repeat join (same or new name) is context loss, not a second agent
      return `You are already in room "${args.room}" as ${joinedAs.get(args.room)}${pids.get(args.room) ? ` (participant_id ${pids.get(args.room)})` : ""}. No need to join again, and do not join under another name. Continue with wait_for_messages or read_messages.`;
    }
    const mine = local.find((t) => t.def.function.name === name);
    if (mine) { heartbeat(name, args); return String(await mine.run(args)); }
    if (name !== "join_room" && name !== "wait_for_messages") heartbeat(name, args); // room calls too, so the feed is complete
    if (!hubTools.has(name)) return `No tool named ${name}. Available: ${[...hubTools, ...local.map((t) => t.def.function.name)].join(", ")}`;
    // 55s long-polls (wait_for_messages) must not trip the SDK's default 60s request timeout
    const r = (await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 })) as { isError?: boolean; content?: { type: string; text?: string }[] };
    const text = (r.content ?? [])
      .map((c) => c.text ?? "")
      .join("\n")
      .trim();
    if (!r.isError && name === "join_room" && args.room) {
      joined.add(args.room);
      joinedAs.set(args.room, args.name ?? "?");
      const m = /"participant_id":\s*"([^"]+)"/.exec(text);
      if (m) pids.set(args.room, m[1]);
    }
    if (!r.isError && name === "leave_room" && args.room) joined.delete(args.room);
    return clampHub((r.isError ? "ERROR: " : "") + (text || "(no content)"));
  }

  /** On the way out for a reason the model did not choose, leave every room so nobody waits on an empty seat. */
  async function bow(reason: string) {
    for (const room of [...joined]) {
      try {
        await client.callTool({ name: "leave_room", arguments: { room, reason: `seat exiting: ${reason}`.slice(0, 600) } }, undefined, { timeout: 30_000 });
        log(`[${provider.label}] left ${room}: ${reason}`);
      } catch (e) {
        log(`[${provider.label}] could not leave ${room}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  const messages: Msg[] = [
    { role: "system", content: systemPrompt(cwd, instructions, write, shell) },
    { role: "user", content: opts.prompt },
  ];
  const usage: Usage = { prompt_tokens: 0, completion_tokens: 0, cost: 0 };
  const size = () => JSON.stringify(messages).length;

  // checkpointTrim's floor: how far below the ceiling a firing drops to. Low enough that many steps of
  // pure append pass before the ceiling is hit again, so trimming is an infrequent checkpoint rather than
  // a near-every-step FIFO splice that would invalidate a provider prompt cache on ~half of all turns.
  const CHECKPOINT_FLOOR_RATIO = 0.5;

  /**
   * Drop whole turns (an assistant message with its tool results and any hint that followed) from the
   * front. Legacy mode (checkpointTrim off) drops just enough to sit under the ceiling, which tends to
   * refire on roughly every other step once a seat rides the ceiling — cache-hostile, since it edits the
   * middle of the transcript almost every turn. checkpointTrim instead drops down to a lower floor in one
   * shot and marks the cut with a single checkpoint message, so the transcript is append-only (and its
   * prefix stable across consecutive requests) between the rarer firings.
   */
  function trim() {
    if (size() <= maxContextChars) return;
    const target = checkpointTrim ? Math.round(maxContextChars * CHECKPOINT_FLOOR_RATIO) : maxContextChars;
    let dropped = 0;
    while (size() > target && messages.length > 3) {
      let end = 3;
      while (end < messages.length && messages[end].role !== "assistant") end++;
      messages.splice(2, end - 2);
      dropped++;
    }
    if (dropped) {
      if (checkpointTrim) messages.splice(2, 0, { role: "user", content: `[checkpoint: ${dropped} earlier turn(s) elided to stay within the context window]` });
      log(`[${provider.label}] dropped ${dropped} older turn(s) to fit the context window${checkpointTrim ? " (checkpoint)" : ""}`);
    }
  }

  // a SIGTERM (the launcher stopping, an operator shedding load) leaves the rooms first, so the seat is not a phantom voter
  let stopping = false;
  const onSignal = () => { if (stopping) return; stopping = true; log(`[${provider.label}] stopped by signal`); bow("stopped by signal").then(() => opts.mcpUrl ? client.transport && (client.transport as { terminateSession?: () => Promise<void> }).terminateSession?.() : undefined).catch(() => {}).finally(() => process.exit(143)); };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  // the parent's stderr pipe can vanish before the seat does; a log line must never kill the seat
  process.stderr.on("error", () => {});
  const deadline = Date.now() + maxMinutes * 60_000;
  let nudges = 0;
  let final = "";
  let lastHint = "";
  let ok = true;
  let steps = 0;
  const basePrompt = messages[0].content;
  for (steps = 1; steps <= maxSteps; steps++) {
    stepNo = steps;
    messages[0] = { role: "system", content: basePrompt + identityCard() };
    if (Date.now() > deadline) {
      log(`[${provider.label}] ${maxMinutes} min budget spent`);
      await bow(`${maxMinutes} min budget spent`);
      break;
    }
    trim();
    let reply: Reply;
    try {
      reply = await provider.complete(messages, tools);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`[${provider.label}] provider error: ${msg}`);
      await bow(`provider error: ${msg.slice(0, 120)}`);
      final = final || `ERROR: ${msg}`;
      ok = false;
      break;
    }
    usage.prompt_tokens += reply.usage?.prompt_tokens ?? 0;
    usage.completion_tokens += reply.usage?.completion_tokens ?? 0;
    usage.cost += reply.usage?.cost ?? 0;
    const calls = reply.toolCalls;
    messages.push({
      role: "assistant",
      content: reply.content || null,
      ...(calls.length ? { tool_calls: calls } : {}),
      // reasoning models continue a thought across tool calls; without this the next turn starts cold
      ...(reply.reasoningDetails?.length ? { reasoning_details: reply.reasoningDetails } : {}),
    });
    if (reply.content.trim()) final = reply.content.trim();
    if (!calls.length) {
      // a model that narrates instead of acting gets two nudges, then we take its text as final
      if (nudges++ < 2 && opts.mcpUrl && joined.size) {
        log(`[${provider.label}] step ${steps}: no tool call; nudging`);
        messages.push({ role: "user", content: "You made no tool call. If your brief is not finished, act with a tool now (wait_for_messages / send_message / vote / leave_room). If it is finished and you have left the room, say so in one line." });
        continue;
      }
      break;
    }
    for (const call of calls) {
      let args: Record<string, string> = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        messages.push({ role: "tool", tool_call_id: call.id, content: `Your arguments were not valid JSON: ${call.function.arguments?.slice(0, 200)}` });
        continue;
      }
      log(`[${provider.label}] step ${steps}: ${call.function.name} ${JSON.stringify(args).slice(0, 160)}`);
      let result: string;
      try {
        result = await callTool(call.function.name, args);
      } catch (e) {
        result = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
      }
      // an empty wait is not worth a model turn (each one is a provider request against a shared per-minute limit): repeat it locally first
      if (call.function.name === "wait_for_messages" && idleWaits > 1) {
        for (let k = 1; k < idleWaits && !stopping && Date.now() < deadline; k++) {
          let v: HubView | undefined;
          try {
            v = result.startsWith("ERROR:") ? undefined : (JSON.parse(result) as HubView);
          } catch {}
          if (!v || (v.messages?.length ?? 0) > 0 || actionable(v)) break;
          log(`[${provider.label}] step ${steps}: empty wait ${k}/${idleWaits - 1}; waiting again without a model turn`);
          try {
            result = await callTool(call.function.name, args);
          } catch (e) {
            result = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
            break;
          }
        }
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
      // the hub's hint is the one line that matters most and the one a weak model skips inside a long JSON result
      if (hubTools.has(call.function.name) && !result.startsWith("ERROR:")) {
        try {
          const view = JSON.parse(result) as HubView;
          if (actionable(view) && view.hint !== lastHint) {
            lastHint = view.hint!;
            messages.push({ role: "user", content: `Hub: ${view.hint}` });
          }
        } catch {
          /* not JSON: nothing to lift */
        }
      }
    }
    if (steps === maxSteps) {
      log(`[${provider.label}] step cap ${maxSteps} reached`);
      await bow(`step cap ${maxSteps} reached`);
    }
  }

  log(`[${provider.label}] ${steps} step(s), ${usage.prompt_tokens} prompt + ${usage.completion_tokens} completion tokens${usage.cost ? `, $${usage.cost.toFixed(4)}` : ""}`);
  if (opts.mcpUrl) {
    // a finish that skipped leave_room would leave an active voter behind until the idle sweep
    if (joined.size) await bow("finished without leaving");
    // client.close() alone sends no DELETE, so the hub would not see the session end
    const transport = client.transport as { terminateSession?: () => Promise<void> } | undefined;
    await transport?.terminateSession?.().catch(() => {});
    await client.close().catch(() => {});
  }
  return { final: final || "(no final message)", usage, steps, ok };
}
