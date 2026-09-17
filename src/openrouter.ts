#!/usr/bin/env node
/**
 * OpenRouter seat: any OpenRouter model holding one chatroom seat. The loop, tools and prompt live in
 * src/seat.ts; this file is only the provider (chat-completions over OpenRouter, with retries and
 * reasoning blocks passed back) and the CLI the launcher and the spawner call.
 *
 *   openrouter -p "<brief>" --mcp-url http://127.0.0.1:7717/mcp [--model slug] [--cwd dir] [--write]
 *              [--no-shell] [--max-minutes 45] [--reasoning low|medium|high]
 */
import { resolve } from "node:path";
import { type ChatProvider, type Msg, type Reply, type ToolCall, type ToolDef, runSeat } from "./seat.js";
import { loadDotEnv } from "./env.js";
loadDotEnv();

const argv = process.argv.slice(2);
const flag = (name: string, def?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const has = (name: string) => argv.includes(`--${name}`);
const pIdx = argv.indexOf("-p");
const PROMPT = (pIdx >= 0 ? argv[pIdx + 1] : flag("prompt")) ?? "";
const MODEL = flag("model", process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-v4.1-flash")!;
const BASE = (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "");
const KEY = process.env.OPENROUTER_API_KEY ?? "";
const REASONING = flag("reasoning");
const REQUEST_TIMEOUT_MS = Number(flag("request-timeout-ms", "180000"));
const say = (s: string) => process.stderr.write(`${s}\n`);

if (!PROMPT.trim()) {
  say('usage: openrouter -p "<prompt>" --mcp-url <url> [--model slug] [--cwd dir] [--write] [--no-shell] [--max-minutes 45] [--reasoning low|medium|high]');
  process.exit(2);
}
if (!KEY && BASE.startsWith("https://openrouter.ai")) {
  say("OPENROUTER_API_KEY is not set; get a key at https://openrouter.ai/keys and export it before launching an OpenRouter seat.");
  process.exit(2);
}

interface Completion {
  choices?: {
    finish_reason?: string;
    message?: { content?: string | { text?: string }[] | null; tool_calls?: ToolCall[]; reasoning_details?: unknown[] };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { message?: string; code?: number };
}
const textOf = (c: string | { text?: string }[] | null | undefined): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => p.text ?? "").join("") : "");

export function openRouterProvider(model: string, reasoning?: string): ChatProvider {
  return {
    label: `openrouter ${model}`,
    async complete(messages: Msg[], tools: ToolDef[]): Promise<Reply> {
      let wait = 2000;
      for (let attempt = 1; attempt <= 5; attempt++) {
        let res: Response | undefined;
        let body: Completion = {};
        let netErr = "";
        try {
          // a stalled request would park the seat inside this call, past its budget and out of the room's reach
          res = await fetch(`${BASE}/chat/completions`, {
            method: "POST",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${KEY}`,
              "HTTP-Referer": "https://github.com/norvalbv/agent-chatroom-mcp",
              "X-OpenRouter-Title": "agent-chatroom-mcp",
            },
            body: JSON.stringify({
              model,
              messages,
              tools,
              parallel_tool_calls: true,
              usage: { include: true },
              ...(reasoning ? { reasoning: { effort: reasoning } } : {}),
            }),
          });
          body = (await res.json().catch(() => ({}) as Completion)) as Completion;
        } catch (e) {
          netErr = e instanceof Error ? e.message : String(e);
        }
        // OpenRouter reports upstream failures both as HTTP errors and as an `error` on a 200; the network reports them as throws
        const err = netErr || (!res!.ok || body.error ? (body.error?.message ?? `HTTP ${res!.status}`) : "");
        if (!err) {
          const m = body.choices?.[0]?.message;
          return {
            content: textOf(m?.content),
            toolCalls: m?.tool_calls ?? [],
            reasoningDetails: m?.reasoning_details,
            usage: body.usage,
          };
        }
        const retriable = !!netErr || res!.status === 429 || res!.status >= 500 || body.error?.code === 429 || (body.error?.code ?? 0) >= 500;
        say(`[openrouter] ${err}${retriable && attempt < 5 ? ` — retry ${attempt}/4 in ${wait / 1000}s` : ""}`);
        if (!retriable || attempt === 5) throw new Error(`OpenRouter: ${err}`);
        await new Promise((r) => setTimeout(r, wait));
        wait *= 2;
      }
      throw new Error("unreachable");
    },
  };
}

const result = await runSeat(openRouterProvider(MODEL, REASONING), {
  prompt: PROMPT,
  mcpUrl: flag("mcp-url", process.env.CHATROOM_MCP_URL),
  cwd: resolve(flag("cwd", process.cwd())!),
  write: has("write"),
  shell: !has("no-shell"),
  maxMinutes: Number(flag("max-minutes", "45")),
  maxSteps: Number(flag("max-steps", "600")),
  maxToolChars: Number(flag("max-tool-chars", "6000")),
  maxContextChars: Number(flag("max-context-chars", "240000")),
  log: say,
});
process.stdout.write(`${result.final}\n`);
process.exit(result.ok ? 0 : 1);
