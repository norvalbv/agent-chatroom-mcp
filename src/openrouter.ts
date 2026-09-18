#!/usr/bin/env node
/**
 * OpenRouter seat: any OpenRouter model holding one chatroom seat. The loop, tools and prompt live in
 * src/seat.ts; this file is only the provider (chat-completions over OpenRouter, with retries and
 * reasoning blocks passed back) and the CLI the launcher and the spawner call.
 *
 *   openrouter -p "<brief>" --mcp-url http://127.0.0.1:7717/mcp [--model slug] [--cwd dir] [--write]
 *              [--no-shell] [--max-minutes 45] [--reasoning low|medium|high] [--checkpoint-trim]
 */
import { resolve } from "node:path";
import { type ChatProvider, type Msg, type Reply, type ToolCall, type ToolDef, runSeat } from "./seat.js";
import { loadDotEnv, SEAT_ENV_EXCLUSIONS } from "./env.js";
// Do not reload the human-control token omitted by the launcher/spawner.
loadDotEnv(undefined, { exclude: SEAT_ENV_EXCLUSIONS });

const argv = process.argv.slice(2);
const flag = (name: string, def?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const has = (name: string) => argv.includes(`--${name}`);
const pIdx = argv.indexOf("-p");
const PROMPT = (pIdx >= 0 ? argv[pIdx + 1] : flag("prompt")) ?? "";
const MODEL = flag("model", process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-v4-flash-0731")!;
const BASE = (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "");
const KEY = process.env.OPENROUTER_API_KEY ?? "";
const REASONING = flag("reasoning");
const REQUEST_TIMEOUT_MS = Number(flag("request-timeout-ms", "180000"));
/** attempts per request; the backoff is 2s doubling to a 45s cap with jitter, so 8 attempts ride out ~3 minutes of 429s (a fleet of free seats sees them) */
const RETRIES = Math.max(1, Number(flag("retries", "8")));
let rateLimited = 0;
/** how long a seat keeps retrying 429s before giving up (default 20 min; the launcher's --timeout bounds it anyway) */
const RATE_LIMIT_PATIENCE_MS = Number(flag("rate-limit-patience-min", "20")) * 60_000;
const say = (s: string) => process.stderr.write(`${s}\n`);

if (!PROMPT.trim()) {
  say('usage: openrouter -p "<prompt>" --mcp-url <url> [--model slug] [--cwd dir] [--write] [--no-shell] [--max-minutes 45] [--reasoning low|medium|high] [--checkpoint-trim]');
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
      // a rate limit is weather, not a failure: keep retrying it for as long as the seat's budget allows
      const deadline = Date.now() + RATE_LIMIT_PATIENCE_MS;
      for (let attempt = 1; ; attempt++) {
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
        const is429 = res?.status === 429 || body.error?.code === 429;
        if (is429) rateLimited++;
        const retriable = !!netErr || is429 || (res?.status ?? 0) >= 500 || (body.error?.code ?? 0) >= 500;
        // Retry-After / X-RateLimit-Reset when the provider says how long; otherwise doubling with jitter, capped
        const hinted = Number(res?.headers.get("retry-after")) * 1000 || Math.max(0, Number(res?.headers.get("x-ratelimit-reset")) - Date.now()) || 0;
        const delay = hinted > 0 && hinted < 120_000 ? hinted + 500 : Math.min(45_000, wait) * (0.7 + Math.random() * 0.6);
        const more = is429 ? Date.now() + delay < deadline : attempt < RETRIES;
        say(`[openrouter] ${err.slice(0, 160)}${retriable && more ? ` — retry ${attempt} in ${Math.round(delay / 1000)}s` : ""}`);
        if (!retriable || !more) throw new Error(`OpenRouter: ${err}`);
        await new Promise((r) => setTimeout(r, delay));
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
  idleWaits: Number(flag("idle-waits", "3")),
  checkpointTrim: has("checkpoint-trim"),
  log: say,
});
if (rateLimited) say(`[openrouter ${MODEL}] ${rateLimited} rate-limited request(s) retried`);
process.stdout.write(`${result.final}\n`);
process.exit(result.ok ? 0 : 1);
