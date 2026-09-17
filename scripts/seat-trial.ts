/**
 * Live trial of one OpenRouter model holding a seat, against a throwaway hub: does it join, open,
 * answer when addressed, engage with a proposal, and leave? A scripted Claude-shaped counterpart
 * plays the rest of the room. Prints one line per stage with the seconds it took, then the seat's
 * step log path. Needs OPENROUTER_API_KEY and `npm run build`; costs a few cents.
 *
 *   npm run seat:trial -- --model deepseek/deepseek-v4.1-flash [--port 7740] [--minutes 8] [--reasoning low]
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const argv = process.argv.slice(2);
const flag = (name: string, def: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const MODEL = flag("model", process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-v4.1-flash");
const PORT = Number(flag("port", "7740"));
const MINUTES = Number(flag("minutes", "8"));
const REASONING = flag("reasoning", "");
const HUB = `http://127.0.0.1:${PORT}`;
const ROOM = "seat-trial";
const SEAT = "seat-1";
const ME = "claude-1";
const TOPIC = "Should this repo's README lead with the swarm launcher or with the hub itself? Pick one and give one reason.";

assert.ok(process.env.OPENROUTER_API_KEY, "export OPENROUTER_API_KEY first");
assert.ok(existsSync("dist/openrouter.js"), "run `npm run build` first");
mkdirSync("logs", { recursive: true });
const LOG = resolve("logs", `seat-trial-${MODEL.replace(/[^\w.-]+/g, "_")}.log`);

const hub = spawn("node", ["dist/index.js"], { env: { ...process.env, PORT: String(PORT), CHATROOM_SPAWN_DRY: "1", CHATROOM_LOG_DIR: "/tmp/seat-trial-spawn" }, stdio: ["ignore", "ignore", "inherit"] });
process.on("exit", () => hub.kill());
for (let i = 0; i < 50; i++) {
  try {
    await fetch(HUB);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 200));
  }
}

const client = new Client({ name: ME, version: "0.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${HUB}/mcp`)));
const mcp = async (tool: string, args: Record<string, unknown>) => {
  const res = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const text = res.content[0]?.text ?? "";
  if (res.isError) throw new Error(`${tool}: ${text}`);
  return JSON.parse(text);
};
interface Line {
  seq: number;
  kind: string;
  from: { name: string };
  content: string;
}
const lines = async (since: number) => (await (await fetch(`${HUB}/rooms/${ROOM}/messages?since=${since}`)).json()) as Line[];

await mcp("join_room", { room: ROOM, name: ME, agent: "claude", topic: TOPIC, expected_participants: 2, quorum: "unanimous" });

const brief = [
  `You are ${SEAT}, one of 2 AI agents meeting in the \`chatroom\` MCP room \`${ROOM}\` to settle this:`,
  "",
  TOPIC,
  "",
  `Join with \`join_room\` (room="${ROOM}", name="${SEAT}", agent="openrouter", topic="${TOPIC}", expected_participants=2). The room has a shared board and a proposal/vote mechanism; the tools explain themselves. Work it out between you; when the room has concluded, \`leave_room\` and report back with "CONCLUSION: ..." or "NO CONSENSUS: ...". Never set timeout_ms above 55000; leave when the hub says the room concluded or closed, or when wait_for_messages says leaving_would_block is false and you have nothing left to do.`,
  `Working directory: ${process.cwd()}; you may read the project. Do NOT modify any files.`,
].join("\n");
const seatArgs = ["dist/openrouter.js", "-p", brief, "--mcp-url", `${HUB}/mcp`, "--cwd", process.cwd(), "--model", MODEL, "--max-minutes", String(MINUTES)];
if (REASONING) seatArgs.push("--reasoning", REASONING);
const seat = spawn("node", seatArgs, { stdio: ["ignore", "pipe", "pipe"] });
let seatLog = "";
seat.stdout.on("data", (d) => (seatLog += `[stdout] ${d}`));
seat.stderr.on("data", (d) => (seatLog += d));
let seatExit: number | null | undefined;
seat.on("close", (code) => (seatExit = code));
process.on("exit", () => {
  writeFileSync(LOG, seatLog);
  if (seatExit === undefined) seat.kill();
});

const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(0).padStart(4);
const results: { stage: string; ok: boolean; at: string; note?: string }[] = [];
const report = (stage: string, ok: boolean, note?: string) => {
  results.push({ stage, ok, at: secs(), note });
  console.log(`${ok ? "PASS" : "FAIL"} ${secs()}s  ${stage}${note ? `  (${note})` : ""}`);
};

let seen = 0;
/** Poll the room until `test` finds a line, answering the seat's own questions to us along the way. */
async function until(stage: string, test: (l: Line) => boolean, limitMs: number): Promise<Line | undefined> {
  const end = Date.now() + limitMs;
  while (Date.now() < end && seatExit === undefined) {
    for (const l of await lines(seen)) {
      seen = l.seq;
      if (l.from.name === SEAT && l.kind === "chat" && new RegExp(`@${ME}\\b`).test(l.content) && !test(l)) {
        try {
          await mcp("wait_for_messages", { room: ROOM, timeout_ms: 0 });
          await mcp("send_message", { room: ROOM, content: "Noted; go with your own judgement on that.", force: true });
        } catch {
          /* share cap or similar: the trial is about the seat, not us */
        }
      }
      if (test(l)) {
        report(stage, true, `${l.kind}: ${l.content.slice(0, 80).replace(/\n/g, " ")}`);
        return l;
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  report(stage, false, seatExit !== undefined ? `seat exited ${seatExit}` : `no sign within ${limitMs / 1000}s`);
  return undefined;
}

// 1. joins
await until("joins the room", (l) => l.kind === "system" && l.content.startsWith(`${SEAT} `) && l.content.includes("joined"), 90_000);
// 2. opens (our own opening goes in first; the reveal needs both)
await mcp("submit_opening", { room: ROOM, content: "Lead with the hub: the launcher is one way to use it, the hub is what the repo is." });
await until("submits an opening", (l) => l.kind === "system" && l.content.startsWith("Opening answers"), 120_000);
// 3. answers when addressed
await mcp("wait_for_messages", { room: ROOM, timeout_ms: 0 });
await mcp("send_message", { room: ROOM, content: `@${SEAT} In one sentence: which do you prefer and what is your one reason?`, force: true });
const askedAt = seen;
await until("replies when @-addressed", (l) => l.seq > askedAt && l.from.name === SEAT && l.kind === "chat", 150_000);
// 4. engages with a proposal (vote, challenge or amend)
await mcp("wait_for_messages", { room: ROOM, timeout_ms: 0 });
const pr = await mcp("propose", { room: ROOM, text: "The README leads with the hub (what it is and the tool loop), and the swarm launcher is the second section." });
const proposedAt = seen;
const engaged = await until("engages with the proposal", (l) => l.seq > proposedAt && l.from.name === SEAT && ["vote", "challenge", "proposal"].includes(l.kind), 180_000);
// 5. concludes and leaves: answer a challenge by amending, vote, then watch for the seat's leave
if (engaged?.kind === "challenge") {
  await mcp("wait_for_messages", { room: ROOM, timeout_ms: 0 });
  await mcp("amend", { room: ROOM, proposal_id: pr.id, find: "the second section", replace: "the second section, with a one-line pointer to it at the top" }).catch(() => {});
}
await mcp("wait_for_messages", { room: ROOM, timeout_ms: 0 });
await mcp("vote", { room: ROOM, proposal_id: pr.id, vote: "agree", quote: "The README leads with the hub", reason: "matches what the repo is" }).catch(() => {});
const concluded = await until("room concludes", (l) => l.kind === "conclusion" || (l.kind === "vote" && l.from.name === SEAT && /AGREE/.test(l.content) && l.seq > proposedAt), 180_000);
if (concluded) await until("leaves the room", (l) => l.kind === "system" && l.content === `${SEAT} left the room.`, 120_000);

await mcp("leave_room", { room: ROOM }).catch(() => {});
await client.close().catch(() => {});
if (seatExit === undefined) {
  await new Promise((r) => setTimeout(r, 3000));
  if (seatExit === undefined) seat.kill();
}
const cost = /\$([0-9.]+)/.exec(seatLog)?.[1];
console.log(`\n${MODEL}: ${results.filter((r) => r.ok).length}/${results.length} stages passed${cost ? `, $${cost}` : ""}; seat log: ${LOG}`);
hub.kill();
process.exit(results.slice(0, 4).every((r) => r.ok) ? 0 : 1);
