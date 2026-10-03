/**
 * Mention-to-reply latency for a BUSY claude -p seat (swarm-181144-uxtr, problem 3), on one build at a time.
 * A private hub from <build> (never 7717) hosts room "steer-bench". One claude seat is launched exactly as the swarm
 * launcher does (claudeArgs + that build's heartbeatHookSettings + seat key) with a brief that keeps it heads-down in
 * local Bash steps for a while. Once it is mid-loop (hub shows step >= 2), a scripted peer @-mentions it with a
 * question. We record: seconds from mention to the seat's reply, how many busy steps it had done when it replied
 * (replied mid-turn or only after the loop), and the seat's own token usage. Same brief and prompt on both arms.
 * Run: npx tsx scripts/bench-steer-claude.ts --build <dir with src/ + node_modules> [--reps 3] [--port N] [--out f.json]
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const build = resolve(arg("build", ".")!);
const reps = Number(arg("reps", "3"));
const PORT = Number(arg("port", String(30_000 + Math.floor(Math.random() * 20_000))));
assert.notEqual(PORT, 7717, "never the live hub");
const HTTP = `http://127.0.0.1:${PORT}`;
const model = arg("model", "claude-opus-5-5")!;
const STEPS = Number(arg("steps", "8"));
const SLEEP = Number(arg("sleep", "5"));

const { claudeArgs } = await import(join(build, "src/claude-args.ts"));
const { heartbeatHookSettings, seatBeat } = await import(join(build, "src/env.ts"));

const hub = spawn("npx", ["tsx", "src/index.ts"], { cwd: build, env: { ...process.env, PORT: String(PORT), CHATROOM_SPAWN_DRY: "1", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: "", CHATROOM_LOG_DIR: mkdtempSync(join(tmpdir(), "steer-bench-log-")) }, stdio: ["ignore", "ignore", "inherit"] });
process.on("exit", () => hub.kill());
for (let i = 0; ; i++) {
  try { await fetch(`${HTTP}/`); break; } catch { if (i > 150) throw new Error("hub did not start"); await new Promise((r) => setTimeout(r, 200)); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: unknown[] = [];

for (let rep = 1; rep <= reps; rep++) {
  const room = `steer-bench-${rep}`;
  const peer = new Client({ name: "pinger", version: "0.0.0" });
  await peer.connect(new StreamableHTTPClientTransport(new URL(`${HTTP}/mcp`)));
  const call = async (tool: string, args: Record<string, unknown>) => {
    const r = (await peer.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    if (r.isError) throw new Error(`${tool}: ${r.content[0]?.text}`);
    return JSON.parse(r.content[0]!.text);
  };
  const joined = await call("join_room", { room, name: "pinger", agent: "script", expected_participants: 0, topic: "steering bench" });
  const pid = joined.participant_id;

  const dir = mkdtempSync(join(tmpdir(), "steer-bench-seat-"));
  const beat = seatBeat(`${HTTP}/mcp`, `bench-${rep}-${Date.now()}`);
  const mcpJson = join(dir, "mcp.json");
  writeFileSync(mcpJson, JSON.stringify({ mcpServers: { chatroom: { type: "http", url: beat.mcpUrl } } }));
  const tools = ["Bash", "mcp__chatroom__join_room", "mcp__chatroom__send_message", "mcp__chatroom__wait_for_messages", "mcp__chatroom__leave_room", "mcp__chatroom__pass", "mcp__chatroom__read_messages"];
  const args = claudeArgs({ mcpJson, tools, model, settings: heartbeatHookSettings(join(build, "scripts/heartbeat-hook.mjs")) });
  const prompt = [
    `You are "worker" in chatroom room "${room}". First call join_room(room="${room}", name="worker", agent="claude").`,
    `Then do your local task: run the Bash command \`sleep ${SLEEP}; echo step N\` for N = 1..${STEPS}, one Bash call per step, in order. Do not call chatroom tools during the loop unless you need to.`,
    `If someone in the room addresses you, answer them with send_message(room, content, reply_to=<their message id>).`,
    `After the loop, call wait_for_messages(room="${room}", timeout_ms=5000) once, answer anything addressed to you that you have not answered, then leave_room(room="${room}", reason="bench done").`,
  ].join("\n");
  const t0seat = Date.now();
  const seat = spawn("claude", args, { cwd: dir, env: { ...process.env, ...beat.env }, stdio: ["pipe", "pipe", "pipe"] });
  seat.stdin.end(prompt);
  let out = "";
  seat.stdout.on("data", (d) => (out += d));
  const exited = new Promise<number | null>((r) => seat.on("close", r));

  const worker = async () => ((await (await fetch(`${HTTP}/rooms/${room}`)).json()) as { participants: { name: string; working: { step: number } | null }[] }).participants.find((p) => p.name === "worker");
  // tag it once it is heads-down in the loop
  let w;
  for (let i = 0; i < 600; i++) { w = await worker(); if ((w?.working?.step ?? 0) >= 2) break; await sleep(500); }
  const mention = await call("send_message", { room, participant_id: pid, content: "@worker quick question while you work: what is 17*3? Reply now if you can." });
  const tMention = Date.now();
  const stepAtMention = w?.working?.step ?? 0;
  let reply: { ts: string; content: string } | undefined;
  let stepAtReply = 0;
  for (let i = 0; i < 2400 && !reply; i++) {
    const msgs = (await (await fetch(`${HTTP}/rooms/${room}/messages?since=${mention.seq}`)).json()) as { messages?: any[] } | any[];
    const list = Array.isArray(msgs) ? msgs : (msgs.messages ?? []);
    reply = list.find((m: any) => m.from?.name === "worker" && m.kind !== "system" && (m.replyTo === mention.id || /51/.test(m.content)));
    if (reply) { stepAtReply = (await worker())?.working?.step ?? 0; break; }
    if (seat.exitCode !== null) break;
    await sleep(250);
  }
  const code = await Promise.race([exited, sleep(300_000).then(() => { seat.kill(); return null; })]);
  let usage: any = {};
  try { const j = JSON.parse(out); usage = { ...j.usage, num_turns: j.num_turns, cost_usd: j.total_cost_usd }; } catch { /* killed */ }
  const r = {
    rep, room, exit: code,
    mention_to_reply_s: reply ? (Date.parse(reply.ts) - tMention) / 1000 : null,
    replied: !!reply,
    step_at_mention: stepAtMention, step_at_reply: stepAtReply,
    replied_mid_loop: !!reply && stepAtReply < STEPS + 1, // +1: the join step
    seat_wall_s: (Date.now() - t0seat) / 1000,
    input_tokens: usage.input_tokens, cache_read_input_tokens: usage.cache_read_input_tokens, cache_creation_input_tokens: usage.cache_creation_input_tokens, output_tokens: usage.output_tokens, num_turns: usage.num_turns, cost_usd: usage.cost_usd,
    stats: await (await fetch(`${HTTP}/rooms/${room}/stats`)).json(),
  };
  console.log(JSON.stringify({ ...r, stats: undefined }));
  results.push(r);
  await peer.close();
}
const outFile = arg("out");
const head = spawnSync("git", ["-C", build, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim() || "(not a git dir)";
if (outFile) writeFileSync(outFile, JSON.stringify({ build, build_head: arg("label", head), port: PORT, model, steps: STEPS, sleep_s: SLEEP, results }, null, 2));
hub.kill();
process.exit(0);
