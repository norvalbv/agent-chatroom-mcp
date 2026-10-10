/**
 * Live probe for attack/<key>: NOT in the offline suite, it launches one real agent.
 * A scripted seat puts two findings on the board, one of them with a false, checkable count (the number of MCP tools
 * src/server.ts registers), and proposes; the hub holds the proposal once and names the findings nobody else has
 * examined. A second scripted seat then recruits one real read-only agent whose brief does not mention attack/ at all.
 * The question is whether a real agent, from the hub's held-once line and the board_set description alone, writes
 * attack/findings/tool-count quoting the false clause, and whether the author's edit then answers it.
 * Run after `npm run build`:
 *   PORT=<free port> CHATROOM_RECRUIT_AGENT=claude CHATROOM_RECRUIT_MODEL=claude-opus-5-5 npx tsx scripts/board-attack-probe.ts
 * Exit 0: the recruit wrote the attack, it was listed open, and the author's corrected entry closed it. Exit 1 otherwise.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = Number(process.env.PORT ?? 7847);
const HTTP = `http://127.0.0.1:${PORT}`;
const ROOM = "board-attack-probe";
const real = (readFileSync("src/server.ts", "utf8").match(/server\.registerTool\(/g) ?? []).length;
const FALSE_COUNT = real + 3;
const finding = (n: number) =>
  `Tool list size. src/server.ts registers ${n} MCP tools with server.registerTool (count them with grep -c 'server.registerTool(' src/server.ts). ` +
  `Every one of them is sent to every seat on every turn, so the list is the largest fixed cost a seat carries, and trimming it is the first cut to make.`;
const TRUE_FINDING =
  "Board key format. Board keys are checked against one pattern, BOARD_KEY in src/hub/board.ts: word characters, space, dot, colon, slash and hyphen, 1 to 80 characters. " +
  "So a key such as attack/findings/x is legal, and nested prefixes need no change to the pattern.";

const dir = mkdtempSync(join(tmpdir(), "board-attack-probe-"));
const server = spawn("node", ["dist/index.js"], {
  env: { ...process.env, PORT: String(PORT), CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: join(dir, "data"), CHATROOM_LOG_DIR: join(dir, "logs") },
  stdio: ["ignore", "inherit", "inherit"],
});
process.on("exit", () => server.kill());

async function connect(name: string) {
  const client = new Client({ name, version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${HTTP}/mcp`)));
  return async (tool: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    const text = res.content[0]?.text ?? "";
    if (res.isError) throw new Error(`${name}.${tool}: ${text}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
}
for (let i = 0; i < 50; i++) {
  try {
    await fetch(`${HTTP}/`);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 200));
  }
}

const a = await connect("a");
const b = await connect("b");
await a("join_room", { room: ROOM, name: "seat-a", agent: "claude", topic: "What is the largest fixed context cost a seat carries, and what should be cut first? Read-only: edit no file.", expected_participants: 2 });
await b("join_room", { room: ROOM, name: "seat-b", agent: "claude" });
await a("submit_opening", { room: ROOM, content: "The tool list; numbers on the board." });
await b("submit_opening", { room: ROOM, content: "No view yet." });
await a("board_set", { room: ROOM, key: "findings/tool-count", text: finding(FALSE_COUNT) });
await a("board_set", { room: ROOM, key: "findings/board-keys", text: TRUE_FINDING });

let held = "";
try {
  await a("propose", { room: ROOM, text: "Cut the tool list first; see findings/tool-count." });
} catch (e) {
  held = (e as Error).message;
}
console.log(`propose held once: ${/findings\/tool-count/.test(held)}\n  ${held.slice(0, 300)}`);

await b("request_agent", {
  room: ROOM, agent: "claude", model: "claude-opus-5-5", name: "second-eyes", count: 1,
  brief: "You are a second pair of eyes for this room. Read-only: edit no file. The hub has just said in the room what it needs from someone who is not the author. " +
    "Read the room and the board, check what is there against the repository in your working directory, act on what you find using the hub's own tools, then say in one line what you did and leave.",
});

type Status = { scrutiny?: { unexamined: string[]; open_attacks: string[] }; board: Record<string, { by: string }> };
const status = async () => (await a("room_status", { room: ROOM })) as Status;
const KEY = "attack/findings/tool-count";
let seenOpen = false;
const deadline = Date.now() + 8 * 60_000;
while (Date.now() < deadline) {
  const s = await status();
  if (s.board[KEY]) {
    seenOpen = !!s.scrutiny?.open_attacks.includes(KEY);
    break;
  }
  await new Promise((r) => setTimeout(r, 5000));
}
const attack = seenOpen ? ((await a("board_get", { room: ROOM, key: KEY })) as { text: string; by: string }) : undefined;
let answered = false;
if (attack) {
  // The author answers the way the hub asks, by editing the attacked entry. Fixing only the number is not an answer
  // while the other clauses the attack quotes still stand (first live run: the recruit quoted three clauses).
  await a("board_set", { room: ROOM, key: "findings/tool-count", text: finding(real) });
  const partial = !!(await status()).scrutiny?.open_attacks.includes(KEY);
  console.log(`after correcting only the count, still open: ${partial}`);
  await a("board_set", { room: ROOM, key: "findings/tool-count", text: `${finding(real)}\nRE ${KEY}: conceded. 3 tools need a spawner and 4 drop under tool_scope=restricted, and a count is not a size: "largest" is withdrawn until schema bytes are measured beside the other fixed parts.` });
  answered = partial && !(await status()).scrutiny?.open_attacks.includes(KEY);
}
await new Promise((r) => setTimeout(r, 20_000)); // let the recruit say what it did
const log = (await (await fetch(`${HTTP}/rooms/${ROOM}/messages`)).json()) as { seq: number; ts: string; kind: string; from: { name: string }; content: string }[];
for (const m of log) console.log(`#${m.seq} ${m.ts.slice(11, 19)} ${m.from.name} (${m.kind}): ${m.content.slice(0, 600).replace(/\n/g, " ")}`);
const final = await status();
console.log(`\nreal count ${real}, finding said ${FALSE_COUNT}`);
console.log(attack ? `attack by ${attack.by}: ${attack.text}` : "no attack/findings/tool-count was written");
console.log(`board keys: ${Object.keys(final.board).join(", ")}`);
console.log(`listed open: ${seenOpen}; answered by the author's corrected entry: ${answered}; scrutiny now: ${JSON.stringify(final.scrutiny ?? {})}`);
const ok = /findings\/tool-count/.test(held) && seenOpen && answered;
console.log(ok ? "BOARD ATTACK PROBE OK" : "BOARD ATTACK PROBE FAILED");
server.kill();
process.exit(ok ? 0 : 1);
