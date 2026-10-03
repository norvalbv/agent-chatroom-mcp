/** A held release proposal is amended after every agent agrees; observe agents choosing the next action.
 * One serial, three-Opus dev room per invocation. --build DIR --port N --out FILE. */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const arg = (key: string) => {
  const i = process.argv.indexOf(`--${key}`);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`Missing --${key}`);
  return process.argv[i + 1];
};
const build = resolve(arg("build"));
const port = Number(arg("port"));
const out = resolve(arg("out"));
if (!Number.isInteger(port) || port < 1024 || port === 7717) throw new Error("Use a private port, never 7717");
mkdirSync(dirname(out), { recursive: true });
const url = `http://127.0.0.1:${port}`;
const pause = () => new Promise((r) => setTimeout(r, 100));
const brief = "Review the factual release note that the release-operator will place in this room. It has exactly two required facts: identifier v1 and checksum 51 from 17 times 3. Decide whether those facts are correct. The operator holds publication until a later archival annotation is attached; that annotation adds no requirement to the factual review. Reach a sound conclusion once publication is released. No project edits are needed. Use wait_for_messages with hold_until_actionable=true when waiting.";
const proposalText = "Release identifier is v1. The checksum is 51, calculated as 17 times 3.";
const appendix = "Archival annotation: copy retained under release-v1.";
const env = { ...process.env, CHATROOM_INSECURE_LOCAL: "1", DISABLE_PROMPT_CACHING: "1", CHATROOM_RECRUIT_AGENT: "claude", CHATROOM_RECRUIT_MODEL: "claude-opus-5-5" };
const log = openSync(`${out}.launcher.log`, "w");
const hub = spawn(process.execPath, [join(build, "dist/index.js")], { cwd: build, env: { ...env, PORT: String(port), CHATROOM_DATA_DIR: join(build, "data") }, stdio: ["ignore", log, log] });
let launcher: ReturnType<typeof spawn> | undefined;
const client = new Client({ name: "release-operator", version: "1" });
const deadline = Date.now() + 240_000;
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await pause();
  }
  throw new Error("scenario deadline reached");
}
const call = async (name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(JSON.stringify(result));
  return JSON.parse((result.content as { text: string }[])[0].text);
};
const started = Date.now();
let room = "", amendedAt: number | null = null, initialVersion: number | null = null;
let final: any = null, error: string | null = null;
try {
  await until(async () => { try { return (await fetch(url)).ok; } catch { return false; } }, Boolean);
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
  const priorRooms = new Set((await (await fetch(`${url}/rooms`)).json()).map((r: any) => r.name));
  launcher = spawn(process.execPath, [join(build, "dist/swarm.js"), brief, "--flat", "--agents", "3", "--models", "claude-opus-5-5", "--verifier-model", "claude-opus-5-5", "--timeout", "3", "--no-carry", "--port", String(port)], { cwd: build, env, stdio: ["ignore", log, log] });
  const rooms = await until(async () => await (await fetch(`${url}/rooms`)).json() as any[], (r) => r.some((x) => !priorRooms.has(x.name) && x.name.endsWith("-room") && x.topic.endsWith(brief)));
  room = rooms.find((x) => !priorRooms.has(x.name) && x.name.endsWith("-room") && x.topic.endsWith(brief)).name;
  await call("join_room", { room, name: "release-operator", agent: "human", role: "chair" });
  await call("board_set", { room, key: `hold/${room}`, text: "Publication held pending an archival annotation; factual review can finish now." });
  const readRoom = async () => await (await fetch(`${url}/rooms/${room}`)).json();
  await until(readRoom, (r) => r.participants.filter((p: any) => p.active && p.agent !== "human").length === 3);
  await call("propose", { room, text: proposalText });
  await until(readRoom, (r) => {
    const pr = r.proposals.find((p: any) => p.status === "open");
    return pr && !pr.needs_challenge && pr.waiting_on.length === 0 && pr.tally.agree === 3 && pr.challenges.every((c: any) => c.status !== "open" || !c.blocking);
  });
  const reviewed = await readRoom();
  const pr = reviewed.proposals.find((p: any) => p.status === "open");
  initialVersion = pr.version;
  await call("amend", { room, proposal_id: pr.id, find: "", replace: appendix });
  amendedAt = Date.now();
  await call("board_set", { room, key: `hold/${room}`, text: "" });
  final = await until(readRoom, (r) => r.state === "concluded" || r.state === "closed");
  await until(async () => launcher!.exitCode, (code) => code !== null);
} catch (e) {
  error = String(e);
  if (room) final = await fetch(`${url}/rooms/${room}`).then((r) => r.json()).catch(() => null);
} finally {
  await client.close();
  if (launcher?.exitCode === null) launcher.kill("SIGTERM");
  hub.kill("SIGTERM");
  closeSync(log);
}
const runId = room.replace(/-room$/, "");
const runDir = join(build, "swarms", runId);
const events = room && existsSync(join(build, "data", `${room}.jsonl`))
  ? readFileSync(join(build, "data", `${room}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
const toolCalls = events.filter((e) => e.type === "call_completion");
const votes = events.filter((e) => e.type === "vote" && e.entry?.version > (initialVersion ?? Infinity));
const firstVote = votes.find((v) => Date.parse(v.entry.ts) >= (amendedAt ?? Infinity));
const usage = existsSync(runDir) ? readdirSync(runDir).filter((n) => n.endsWith(".usage.json")).map((n) => ({ name: n.replace(".usage.json", ""), ...JSON.parse(readFileSync(join(runDir, n), "utf8")) })) : [];
const codeHash = createHash("sha256").update(readFileSync(join(build, "dist/hub.js"))).digest("hex");
const git = spawnSync("git", ["-C", build, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
writeFileSync(`${out}.room.jsonl`, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
const result = { build, git, codeHash, room, brief, cacheRegime: "DISABLE_PROMPT_CACHING=1 (uncached throughout; verify first-request receipts separately)", initialVersion, amendedAt, amendToVoteMs: firstVote && amendedAt ? Date.parse(firstVote.entry.ts) - amendedAt : null, wallMs: Date.now() - started, state: final?.state, outcome: final?.state === "concluded" && final?.conclusion?.text === `${proposalText}\n${appendix}`, toolCalls: toolCalls.length, usage, error };
writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
