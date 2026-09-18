/**
 * Item 4 (Rank 4, swarm-082729-8b5j-room prop_a7a385ba): src/openrouter.ts must send a stable
 * per-seat session id (for OpenRouter's sticky routing, so consecutive turns land on the same
 * upstream instance and automatic caching has a chance to hit) and must surface whichever cache
 * fields the provider returns, instead of silently dropping them. It must also add an explicit
 * cache_control breakpoint on the system message for providers that require one (Anthropic,
 * Google) while leaving auto-caching providers (this project's default, DeepSeek) byte-identical.
 *
 * No OpenRouter account is involved: a local HTTP stub plays the model, so this is a mock-endpoint
 * test only (the OpenRouter account backing this swarm has no credit). Needs `npm run build` first
 * (the CLI runs from dist). Run: npx tsx scripts/openrouter-cache-regression.ts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

assert.ok(existsSync("dist/openrouter.js"), "run `npm run build` first: this test runs dist/openrouter.js");

const call = (id: string, name: string, args: unknown) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });

interface Turn {
  content: string | null;
  tool_calls?: unknown[];
  usage?: Record<string, unknown>;
}
interface Body {
  model: string;
  session_id?: string;
  messages: { role: string; content: unknown }[];
}
interface Request {
  headers: Record<string, string | string[] | undefined>;
  body: Body;
}

// ---------- scripted turns per seat run ----------
// "seat": three requests with no MCP room at all (local tools only) — enough to prove the session id
// is stable across consecutive requests and that cache fields from two different provider response
// shapes (Anthropic-style cache_read_input_tokens, OpenAI-style prompt_tokens_details.cached_tokens)
// both get summed into the seat's final usage line.
const scripts: Record<string, Turn[]> = {
  seat: [
    { content: null, tool_calls: [call("c1", "read_file", { path: "package.json", limit: 3 })], usage: { prompt_tokens: 100, completion_tokens: 5, cost: 0.001 } },
    { content: null, tool_calls: [call("c2", "list_dir", { path: "." })], usage: { prompt_tokens: 120, completion_tokens: 5, cost: 0.001, cache_read_input_tokens: 80, cache_creation_input_tokens: 10, cache_discount: 0.0009 } },
    { content: "Done.", usage: { prompt_tokens: 50, completion_tokens: 3, cost: 0.0005, prompt_tokens_details: { cached_tokens: 40 } } },
  ],
  // a non-auto-caching model: the stub only needs one turn to see whether the system message got a breakpoint
  anthropic: [{ content: "Done.", usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.0001 } }],
};
const turns: Record<string, number> = { seat: 0, anthropic: 0 };
const requests: Record<string, Request[]> = { seat: [], anthropic: [] };

const stub = createServer((req, res) => {
  let raw = "";
  req.on("data", (d) => (raw += d));
  req.on("end", () => {
    assert.equal(req.url, "/chat/completions");
    const body = JSON.parse(raw) as Body;
    const which = /anthropic\//.test(body.model) ? "anthropic" : "seat";
    requests[which].push({ headers: req.headers as Record<string, string | string[] | undefined>, body });
    const { usage, ...message } = scripts[which][turns[which]++] ?? { content: "CONCLUSION: done." };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ finish_reason: message.tool_calls ? "tool_calls" : "stop", message }], usage: usage ?? { prompt_tokens: 1, completion_tokens: 1, cost: 0 } }));
  });
});
await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
const STUB = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;

function runSeat(model: string, prompt: string): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn("npx", ["tsx", "src/openrouter.ts", "-p", prompt, "--model", model, "--no-shell"], {
      env: { ...process.env, OPENROUTER_API_KEY: "test-key", OPENROUTER_BASE_URL: STUB },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.stdout.on("data", (d) => (stdout += d));
    child.on("close", (code) => resolvePromise({ code, stderr, stdout }));
  });
}

// ---------- 1. sticky session id: stable across a seat's own consecutive requests ----------
const seatRun = await runSeat("stub/model", "Read package.json, list the directory, then say Done.");
assert.equal(seatRun.code, 0, `seat exited non-zero:\n${seatRun.stderr}`);
assert.equal(requests.seat.length, 3, `expected 3 requests, got ${requests.seat.length}`);
const sessionIds = requests.seat.map((r) => r.headers["x-session-id"]);
assert.ok(sessionIds.every((id) => typeof id === "string" && id.length > 0), `x-session-id header missing on some request: ${JSON.stringify(sessionIds)}`);
assert.equal(new Set(sessionIds).size, 1, `session id was not stable across a seat's own requests: ${JSON.stringify(sessionIds)}`);
assert.ok(requests.seat.every((r) => r.body.session_id === sessionIds[0]), "session_id was not also sent in the request body");

// ---------- 2. two different seat processes get two different session ids (not a hardcoded constant) ----------
const secondSeatRun = await runSeat("stub/model", "Read package.json, list the directory, then say Done.");
assert.equal(secondSeatRun.code, 0, `second seat exited non-zero:\n${secondSeatRun.stderr}`);
const secondSessionId = requests.seat.at(-1)?.headers["x-session-id"];
assert.notEqual(secondSessionId, sessionIds[0], "two separate seat processes must not share a session id");

// ---------- 3. cache fields from two different provider response shapes are surfaced, not dropped ----------
// cached_tokens: 80 (cache_read_input_tokens, turn 2) + 40 (prompt_tokens_details.cached_tokens, turn 3) = 120
// cache_discount: 0.0009 (turn 2 only)
assert.match(seatRun.stderr, /120 cached tok/, `cache-read tokens were not summed into the final usage line:\n${seatRun.stderr}`);
assert.match(seatRun.stderr, /\$0\.0009 cache discount/, `cache_discount was not surfaced in the final usage line:\n${seatRun.stderr}`);
assert.match(seatRun.stderr, /270 prompt \+ 13 completion tokens/, `plain prompt/completion totals regressed:\n${seatRun.stderr}`);

// ---------- 4. cache_control breakpoint only for providers that require one; the default (DeepSeek) is untouched ----------
const seatSystem = requests.seat[0]?.body.messages[0];
assert.equal(seatSystem?.role, "system");
assert.equal(typeof seatSystem?.content, "string", `DeepSeek (auto-caching) system message must stay a plain string, got: ${JSON.stringify(seatSystem?.content).slice(0, 200)}`);

const anthropicRun = await runSeat("anthropic/claude-3-5-sonnet", "Say Done.");
assert.equal(anthropicRun.code, 0, `anthropic-model seat exited non-zero:\n${anthropicRun.stderr}`);
assert.equal(requests.anthropic.length, 1, `expected 1 request, got ${requests.anthropic.length}`);
const anthropicSystem = requests.anthropic[0]?.body.messages[0];
assert.equal(anthropicSystem?.role, "system");
assert.ok(Array.isArray(anthropicSystem?.content), `anthropic/* system message must be transformed into cache_control content parts, got: ${JSON.stringify(anthropicSystem?.content).slice(0, 200)}`);
const part = (anthropicSystem!.content as { type: string; text: string; cache_control?: { type: string } }[])[0];
assert.equal(part.cache_control?.type, "ephemeral", "cache_control breakpoint missing on the system message part");
assert.equal(typeof part.text, "string");
assert.ok(part.text.length > 0, "system prompt text lost in the cache_control transform");

console.log(`OPENROUTER CACHE REGRESSION OK (seat requests: ${requests.seat.length}, anthropic requests: ${requests.anthropic.length})`);
stub.close();
process.exit(0);
