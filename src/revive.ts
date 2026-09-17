/**
 * Revive an existing room: put fresh seats into it with a brief that says to read the board and finish.
 * Rooms outlive their seats (2026-09-17: OpenRouter withdrew the free model mid-run and every seat died while the
 * rooms, boards, handoffs and worktree branches stayed intact). Seats that crash (non-zero exit) are relaunched up
 * to three times; seats that leave are not.
 *
 *   node dist/revive.js --room <name> --brief-file <file> [--model slug] [--agents 3] [--names a,b,c]
 *                       [--write] [--cwd-for name=/path,name=/path] [--max-minutes 60] [--verifier] [--port 7717]
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadDotEnv, repoRoot, seatChildEnv } from "./env.js";

loadDotEnv();
const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 && !args[i + 1]?.startsWith("--") ? args[i + 1] : undefined; };
const has = (n: string) => args.includes(`--${n}`);
const ROOM_ARG = flag("room"); const BRIEF_FILE = flag("brief-file");
if (!ROOM_ARG || !BRIEF_FILE) { console.error("usage: revive --room <name> --brief-file <file> [--model slug] [--agents 3] [--names a,b] [--write] [--cwd-for name=path,...] [--max-minutes 60] [--verifier] [--port 7717]"); process.exit(2); }
const ROOM: string = ROOM_ARG;
const MODEL = flag("model") ?? process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-v4-flash-0731";
const N = Number(flag("agents") ?? 3);
const PORT = Number(flag("port") ?? 7717);
const MAX_MIN = Number(flag("max-minutes") ?? 60);
const WRITE = has("write");
const VERIFIER = has("verifier");
const cwdFor = Object.fromEntries((flag("cwd-for") ?? "").split(",").filter(Boolean).map((kv) => kv.split("=") as [string, string]));
const names = (flag("names")?.split(",").filter(Boolean)) ?? Array.from({ length: N }, (_, i) => `revive-${i + 1}`);
if (VERIFIER) names.push("verifier-revive");
const brief = readFileSync(resolve(BRIEF_FILE), "utf8").trim();
const runId = `revive-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}-${ROOM}`;
const OUT = resolve(repoRoot, "swarms", runId); mkdirSync(OUT, { recursive: true });
const URL_ = `http://127.0.0.1:${PORT}`;
const log = (s: string) => console.log(`\x1b[2m[${new Date().toISOString().slice(11, 19)}]\x1b[0m ${s}`);

const promptFor = (name: string, note: string) => {
  const verifier = name.startsWith("verifier");
  return `You are ${name}, joining the EXISTING chatroom MCP room "${ROOM}" (join_room room="${ROOM}", name="${name}", agent="openrouter"${verifier ? ', role="verifier"' : ""}). ` +
    `Its previous seats all died at once when their model was withdrawn; the room, its board and its git branches survived. Before anything else: room_status, then board_get with no key for the manifest and read every handoff/*, claim/*, inbox/* and verify/* entry, then read_messages for the last 60 messages. ` +
    `Take over the unfinished work those entries describe; do not redo what a handoff says is done. ${note}\n\n${brief}\n\n` +
    (verifier
      ? `You are the verifier: reproduce what the builders claim on a throwaway hub (PORT above 8000, stop it by pid: kill $(lsof -ti:PORT), never pkill), write verify/* entries naming branch, commit and what you ran, challenge the weakest claim of any proposal, and vote only on evidence.`
      : `Colleagues in this room now: ${names.filter((n) => n !== name).join(", ")}. Coordinate with quiet messages; keep the public channel for claims, evidence, the proposal and votes.`) +
    ` Recruit with agent="openrouter" only if a slice needs more hands. When the room concludes, leave_room with a one-line reason. Never set timeout_ms above 55000.`;
};

const children: ReturnType<typeof spawn>[] = [];
function runSeat(name: string, note: string): Promise<number | null> {
  const cwd = cwdFor[name] ?? repoRoot;
  const seatArgs = ["dist/openrouter.js", "-p", promptFor(name, note), "--model", MODEL, "--mcp-url", `${URL_}/mcp`, "--cwd", cwd, "--max-minutes", String(MAX_MIN)];
  if (WRITE && !name.startsWith("verifier")) seatArgs.push("--write");
  const fd = openSync(resolve(OUT, `${name}.log`), "a");
  log(`launching ${name} [${MODEL}] cwd=${cwd}${seatArgs.includes("--write") ? " (write)" : ""}`);
  return new Promise((res) => {
    const child = spawn(process.execPath, seatArgs, { cwd: repoRoot, env: seatChildEnv(), stdio: ["ignore", fd, fd] });
    children.push(child);
    child.on("close", (code) => { log(`${name} exited (${code})`); res(code); });
  });
}
async function withRespawn(name: string): Promise<void> {
  let code = await runSeat(name, "");
  for (let i = 1; i <= 3 && code !== 0; i++) {
    let state = "missing";
    try { state = ((await (await fetch(`${URL_}/rooms/${encodeURIComponent(ROOM)}`)).json()) as { state: string }).state; } catch {}
    if (state !== "open" && state !== "stalled") break;
    log(`${name} crashed (exit ${code}); relaunching as ${name}-r${i}`);
    code = await runSeat(`${name}-r${i}`, `You replace ${name}, whose process crashed.`);
  }
}
process.on("SIGTERM", () => { for (const c of children) c.kill("SIGTERM"); process.exit(143); });
process.on("SIGINT", () => { for (const c of children) c.kill("SIGTERM"); process.exit(130); });
writeFileSync(resolve(OUT, "manifest.json"), JSON.stringify({ room: ROOM, model: MODEL, names, write: WRITE, cwdFor, maxMinutes: MAX_MIN, startedAt: new Date().toISOString() }, null, 2));
if (!existsSync(resolve(repoRoot, "dist/openrouter.js"))) { console.error("build first: npm run build"); process.exit(2); }
log(`reviving ${ROOM} with ${names.length} seat(s); logs in ${OUT}`);
await Promise.all(names.map((n) => withRespawn(n)));
try {
  const r = (await (await fetch(`${URL_}/rooms/${encodeURIComponent(ROOM)}`)).json()) as { state: string; conclusion?: { text: string } };
  log(`${ROOM} is ${r.state}${r.conclusion ? `; conclusion:\n${r.conclusion.text}` : ""}`);
  writeFileSync(resolve(OUT, "result.json"), JSON.stringify(r, null, 2));
} catch {}
