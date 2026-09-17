#!/usr/bin/env node
/**
 * OpenRouter seat: one process, one agent, one MCP session (identity-is-the-connection), driving the
 * hub's tools over OpenRouter's chat-completions API. Why it is a CLI: docs/decisions/ recruitment axis.
 */
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (name: string, def?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const has = (name: string) => argv.includes(`--${name}`);
const pIdx = argv.indexOf("-p");
const PROMPT = (pIdx >= 0 ? argv[pIdx + 1] : flag("prompt")) ?? "";
const MODEL = flag("model", process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-v4.1-flash")!;
const MCP_URL = flag("mcp-url", process.env.CHATROOM_MCP_URL);
const CWD = resolve(flag("cwd", process.cwd())!);
const WRITE = has("write"); // may modify files and run mutating commands
const SHELL = !has("no-shell");
const MAX_STEPS = Number(flag("max-steps", "80"));
const MAX_TOOL_CHARS = Number(flag("max-tool-chars", "6000"));
const MAX_CONTEXT_CHARS = Number(flag("max-context-chars", "240000"));
const BASE = (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "");
const KEY = process.env.OPENROUTER_API_KEY ?? "";
const say = (s: string) => process.stderr.write(`${s}\n`);

if (!PROMPT.trim()) {
  say('usage: openrouter -p "<prompt>" --mcp-url <url> [--model slug] [--cwd dir] [--write] [--no-shell]');
  process.exit(2);
}
if (!KEY && BASE.startsWith("https://openrouter.ai")) {
  say("OPENROUTER_API_KEY is not set; get a key at https://openrouter.ai/keys and export it before launching an OpenRouter seat.");
  process.exit(2);
}

// ---------- wire types (raw REST, snake_case) ----------
interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
type Msg = { role: "system" | "user"; content: string } | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] } | { role: "tool"; tool_call_id: string; content: string };
interface ToolDef {
  type: "function";
  function: { name: string; description?: string; parameters: Record<string, unknown> };
}
interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
}
interface Completion {
  choices?: {
    finish_reason?: string;
    message?: { content?: string | { text?: string }[] | null; tool_calls?: ToolCall[] };
  }[];
  usage?: Usage;
  error?: { message?: string; code?: number };
}

// ---------- local tools: the project, read-only unless --write ----------
const clamp = (s: string) => (s.length > MAX_TOOL_CHARS ? `${s.slice(0, MAX_TOOL_CHARS)}\n…[truncated, ${s.length} chars total]` : s);
const inside = (p: string) => {
  const abs = resolve(CWD, p);
  if (abs !== CWD && !abs.startsWith(`${CWD}/`)) throw new Error(`${p} is outside the working directory ${CWD}`);
  return abs;
};
/**
 * Not a sandbox: the CLI seats get a real shell too and the write rule lives in the prompt. This
 * only stops a read-only seat from mutating the checkout by accident, which weaker models do.
 */
const MUTATING = /(^|[;&|]\s*)(rm|mv|cp|chmod|chown|truncate|dd|kill|pkill|shutdown)\s|sed\s+-i|tee\s|(?<![0-9])>>?\s*[^&|]|git\s+(commit|checkout|reset|clean|push|rebase|merge|stash|apply|restore)|npm\s+(i|install|uninstall|publish)|(yarn|pnpm|pip|brew|cargo)\s+(add|install|remove)/;
/** A `>` inside quotes writes nothing, so the guard above is tested against the unquoted text. */
const unquoted = (command: string) => command.replace(/'[^']*'|"[^"]*"/g, '""');
const sh = (command: string) =>
  new Promise<string>((res) => {
    const child = spawn("bash", ["-lc", command], { cwd: CWD, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => child.kill(), 120_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      res(clamp(`exit ${code}\n${out.trim() || "(no output)"}`));
    });
  });

const localTools: { def: ToolDef; run: (a: Record<string, string>) => string | Promise<string> }[] = [
  {
    def: {
      type: "function",
      function: {
        name: "read_file",
        description: "Read a UTF-8 file in the working directory. Returns numbered lines.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            start: { type: "integer", description: "1-based first line (default 1)" },
            limit: { type: "integer", description: "how many lines (default 400)" },
          },
          required: ["path"],
        },
      },
    },
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
    def: {
      type: "function",
      function: {
        name: "list_dir",
        description: "List a directory in the working directory.",
        parameters: {
          type: "object",
          properties: { path: { type: "string", description: "default '.'" } },
        },
      },
    },
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
    def: {
      type: "function",
      function: {
        name: "search",
        description: "Search file contents under the working directory (grep -rn, node_modules and .git excluded).",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string" },
            path: { type: "string", description: "default '.'" },
          },
          required: ["pattern"],
        },
      },
    },
    run: (a) =>
      new Promise<string>((res) => {
        const child = spawn("grep", ["-rnI", "--exclude-dir=node_modules", "--exclude-dir=.git", "--exclude-dir=dist", "-e", a.pattern, relative(CWD, inside(a.path ?? ".")) || "."], { cwd: CWD, stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        const timer = setTimeout(() => child.kill(), 60_000);
        child.stdout.on("data", (d) => (out += d));
        child.on("close", () => {
          clearTimeout(timer);
          res(clamp(out.trim() || "(no matches)"));
        });
      }),
  },
];
if (SHELL)
  localTools.push({
    def: {
      type: "function",
      function: {
        name: "run_command",
        description: `Run a bash command in ${CWD} (120s limit). ${WRITE ? "You may modify files and commit." : "Read-only: mutating commands are refused."}`,
        parameters: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      },
    },
    run: (a) => (!WRITE && MUTATING.test(unquoted(a.command)) ? `Refused: this seat is read-only, so "${a.command.slice(0, 120)}" was not run. Investigate and report instead.` : sh(a.command)),
  });

// ---------- hub tools over MCP ----------
/** Providers differ on which JSON Schema keywords they tolerate; strip the ones nothing needs. */
const cleanSchema = (v: unknown): unknown => {
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

const client = new Client({ name: "openrouter-seat", version: "0.1.0" });
const hubTools: string[] = [];
const tools: ToolDef[] = localTools.map((t) => t.def);
if (MCP_URL) {
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));
  const listed = await client.listTools();
  for (const t of listed.tools) {
    hubTools.push(t.name);
    const schema = (cleanSchema(t.inputSchema) ?? {}) as Record<string, unknown>;
    if (!schema.type) schema.type = "object";
    if (!schema.properties) schema.properties = {};
    tools.push({
      type: "function",
      function: { name: t.name, description: t.description?.slice(0, 1024), parameters: schema },
    });
  }
  say(`[openrouter ${MODEL}] ${hubTools.length} hub tools + ${localTools.length} local tools`);
} else {
  say(`[openrouter ${MODEL}] no --mcp-url: running with local tools only`);
}

async function callTool(name: string, args: Record<string, string>): Promise<string> {
  const local = localTools.find((t) => t.def.function.name === name);
  if (local) return String(await local.run(args));
  if (!hubTools.includes(name)) return `No tool named ${name}. Available: ${[...hubTools, ...localTools.map((t) => t.def.function.name)].join(", ")}`;
  // 55s long-polls (wait_for_messages) must not trip the SDK's default 60s request timeout
  const r = (await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 })) as {
    isError?: boolean;
    content?: { type: string; text?: string }[];
  };
  const text = (r.content ?? [])
    .map((c) => c.text ?? "")
    .join("\n")
    .trim();
  return clamp((r.isError ? "ERROR: " : "") + (text || "(no content)"));
}

// ---------- the loop ----------
const messages: Msg[] = [
  {
    role: "system",
    content: `You are an autonomous agent in a shared chatroom with other AI agents, working in ${CWD}. Use the tools; do not ask the user questions, there is nobody at the keyboard. Keep going until your brief is done and you have left the room, then reply with one final message and no tool calls.`,
  },
  { role: "user", content: PROMPT },
];
const usage: Usage = { prompt_tokens: 0, completion_tokens: 0, cost: 0 };

async function complete(): Promise<Completion> {
  let wait = 2000;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${KEY}`,
        "HTTP-Referer": "https://github.com/norvalbv/agent-chatroom-mcp",
        "X-OpenRouter-Title": "agent-chatroom-mcp",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools,
        parallel_tool_calls: true,
        usage: { include: true },
      }),
    });
    const body = (await res.json().catch(() => ({}) as Completion)) as Completion;
    // OpenRouter reports upstream failures both as HTTP errors and as an `error` on a 200
    const err = !res.ok || body.error ? (body.error?.message ?? `HTTP ${res.status}`) : "";
    if (!err) return body;
    const retriable = res.status === 429 || res.status >= 500 || body.error?.code === 429 || (body.error?.code ?? 0) >= 500;
    say(`[openrouter] ${err}${retriable && attempt < 5 ? ` — retry ${attempt}/4 in ${wait / 1000}s` : ""}`);
    if (!retriable || attempt === 5) throw new Error(`OpenRouter: ${err}`);
    await new Promise((r) => setTimeout(r, wait));
    wait *= 2;
  }
  throw new Error("unreachable");
}

/** Drop the oldest turns (an assistant message and its tool results) when the transcript outgrows the window. */
function trim() {
  let dropped = false;
  while (JSON.stringify(messages).length > MAX_CONTEXT_CHARS && messages.length > 4) {
    const gone = messages.splice(2, 1)[0];
    if (gone.role === "assistant" && gone.tool_calls?.length) while (messages[2]?.role === "tool") messages.splice(2, 1);
    while (messages[2]?.role === "tool") messages.splice(2, 1);
    dropped = true;
  }
  if (dropped) say("[openrouter] trimmed older turns to fit the context window");
}

const textOf = (c: string | { text?: string }[] | null | undefined): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => p.text ?? "").join("") : "");

let nudges = 0;
let final = "";
for (let step = 1; step <= MAX_STEPS; step++) {
  trim();
  const body = await complete();
  if (body.usage) {
    usage.prompt_tokens = (usage.prompt_tokens ?? 0) + (body.usage.prompt_tokens ?? 0);
    usage.completion_tokens = (usage.completion_tokens ?? 0) + (body.usage.completion_tokens ?? 0);
    usage.cost = (usage.cost ?? 0) + (body.usage.cost ?? 0);
  }
  const choice = body.choices?.[0];
  const content = textOf(choice?.message?.content ?? "");
  const calls = choice?.message?.tool_calls ?? [];
  messages.push({
    role: "assistant",
    content: content || null,
    ...(calls.length ? { tool_calls: calls } : {}),
  });
  if (content.trim()) final = content.trim();
  if (!calls.length) {
    // a model that narrates instead of acting gets two nudges, then we take its text as final
    if (nudges++ < 2 && MCP_URL) {
      say(`[openrouter] step ${step}: no tool call; nudging`);
      messages.push({
        role: "user",
        content: "You made no tool call. If your brief is not finished, act with a tool now (join_room / read_messages / wait_for_messages / send_message / leave_room). If it is finished and you have left the room, say so in one line.",
      });
      continue;
    }
    break;
  }
  for (const call of calls) {
    let args: Record<string, string> = {};
    try {
      args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: `Your arguments were not valid JSON: ${call.function.arguments?.slice(0, 200)}`,
      });
      continue;
    }
    say(`[openrouter] step ${step}: ${call.function.name} ${JSON.stringify(args).slice(0, 160)}`);
    let result: string;
    try {
      result = await callTool(call.function.name, args);
    } catch (e) {
      result = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
    }
    messages.push({ role: "tool", tool_call_id: call.id, content: result });
  }
  if (step === MAX_STEPS) say(`[openrouter] step cap ${MAX_STEPS} reached`);
}

say(`[openrouter ${MODEL}] ${usage.prompt_tokens} prompt + ${usage.completion_tokens} completion tokens${usage.cost ? `, $${usage.cost.toFixed(4)}` : ""}`);
process.stdout.write(`${final || "(no final message)"}\n`);
if (MCP_URL) await client.close().catch(() => {});
process.exit(0);
