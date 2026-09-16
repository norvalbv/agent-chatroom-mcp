#!/usr/bin/env node
/**
 * Swarm orchestrator: one command that turns "get N agents to solve X" into
 * plan -> sub-rooms of workers -> leads room -> verifier with veto -> report.
 *
 *   npx tsx src/swarm.ts "<task>" --agents 6 --cwd /path/to/project [--codex 2] [--apply] [--timeout 30]
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (name: string, def?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const has = (name: string) => argv.includes(`--${name}`);
const task = argv.find((a, i) => !a.startsWith("--") && (i === 0 || !argv[i - 1].startsWith("--")));
if (!task) {
  console.error('usage: swarm "<task>" [--agents 6] [--cwd dir] [--codex 0] [--apply] [--named] [--timeout 30] [--port 7717]');
  process.exit(2);
}
const TOTAL = Math.max(2, Number(flag("agents", "4")));
const WORKERS = TOTAL - 1; // one seat is the verifier
const CWD = resolve(flag("cwd", process.cwd())!);
const CODEX = Math.min(WORKERS, Number(flag("codex", "0")));
const APPLY = has("apply");
const ANON = !has("named"); // worker rooms are anonymous unless --named
const TIMEOUT_MIN = Number(flag("timeout", "30"));
const PORT = Number(flag("port", process.env.PORT ?? "7717"));
const URL_ = `http://127.0.0.1:${PORT}`;
const SWARM_ID = `swarm-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`;
const OUT = resolve(repoRoot, "swarms", SWARM_ID);
mkdirSync(OUT, { recursive: true });

const log = (s: string) => console.log(`\x1b[2m[${new Date().toISOString().slice(11, 19)}]\x1b[0m ${s}`);
const prompt = (file: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((s, [k, v]) => s.split(`{{${k}}}`).join(String(v)), readFileSync(resolve(repoRoot, "prompts", file), "utf8"));

// ---------- hub ----------
async function ensureHub() {
  try {
    await fetch(URL_);
    return;
  } catch {}
  log(`starting hub on :${PORT}`);
  const child = spawn("node", [resolve(repoRoot, "dist/index.js")], {
    env: { ...process.env, PORT: String(PORT), CHATROOM_DATA_DIR: resolve(repoRoot, "data") },
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(URL_);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("hub did not start");
}

// ---------- agents ----------
const children: ChildProcess[] = [];
const mcpJson = resolve(OUT, "mcp.json");
writeFileSync(mcpJson, JSON.stringify({ mcpServers: { chatroom: { type: "http", url: `${URL_}/mcp` } } }));

function runClaude(name: string, text: string, tools: string[], cwd: string): Promise<string> {
  const outFile = resolve(OUT, `${name}.out`);
  const args = ["-p", text, "--mcp-config", mcpJson, "--strict-mcp-config", "--allowedTools", tools.join(",")];
  if (process.env.CLAUDE_MODEL) args.push("--model", process.env.CLAUDE_MODEL);
  return runProc(name, "claude", args, cwd, outFile);
}

function runCodex(name: string, text: string, cwd: string): Promise<string> {
  const outFile = resolve(OUT, `${name}.out`);
  const args = ["exec", "--skip-git-repo-check", "-C", cwd, "-c", `mcp_servers.chatroom.url="${URL_}/mcp"`, "-c", "mcp_servers.chatroom.tool_timeout_sec=120", "-o", outFile];
  if (process.env.CODEX_MODEL) args.push("-m", process.env.CODEX_MODEL);
  args.push(text);
  return runProc(name, "codex", args, cwd, outFile, true);
}

function runProc(name: string, cmd: string, args: string[], cwd: string, outFile: string, outViaFile = false): Promise<string> {
  return new Promise((res) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, MCP_TOOL_TIMEOUT: "120000" }, stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (err += d));
    child.on("close", (code) => {
      writeFileSync(resolve(OUT, `${name}.log`), err);
      if (!outViaFile) writeFileSync(outFile, out);
      const final = outViaFile ? safeRead(outFile) : out;
      log(`${name} exited (${code})`);
      res(final.trim());
    });
  });
}
const safeRead = (f: string) => {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return "";
  }
};

// ---------- live transcript tail ----------
const seen = new Map<string, number>();
async function tailRooms(rooms: string[]) {
  for (const room of rooms) {
    try {
      const since = seen.get(room) ?? 0;
      const msgs = (await (await fetch(`${URL_}/rooms/${room}/messages?since=${since}`)).json()) as { seq: number; from: { name: string }; kind: string; content: string }[];
      for (const m of msgs) {
        seen.set(room, m.seq);
        const short = m.content.length > 300 ? m.content.slice(0, 300) + "…" : m.content;
        console.log(`\x1b[36m[${room.replace(`${SWARM_ID}-`, "")}]\x1b[0m \x1b[1m${m.from.name}\x1b[0m${m.kind !== "chat" ? ` (${m.kind})` : ""}: ${short.replace(/\n+/g, " ")}`);
      }
    } catch {}
  }
}

// ---------- main ----------
interface Plan {
  summary: string;
  done_when: string;
  groups: { id: string; title: string; workers: number; directive: string }[];
  verifier_directive: string;
}

await ensureHub();
log(`swarm ${SWARM_ID}: ${TOTAL} agents (${WORKERS} workers + verifier), project ${CWD}`);
log("planning…");
const planRaw = await runClaude("planner", prompt("planner.md", { TASK: task, CWD, WORKERS, MAX_GROUPS: Math.max(1, Math.floor(WORKERS / 2)) }), ["Read", "Grep", "Glob", "Bash"], CWD);
let plan: Plan;
try {
  plan = JSON.parse(planRaw.slice(planRaw.indexOf("{"), planRaw.lastIndexOf("}") + 1));
} catch {
  console.error("planner did not return JSON:\n" + planRaw);
  process.exit(1);
}
// normalise worker counts to exactly WORKERS
let sum = plan.groups.reduce((a, g) => a + (g.workers || 1), 0);
while (sum < WORKERS) {
  plan.groups[sum % plan.groups.length].workers++;
  sum++;
}
while (sum > WORKERS) {
  const g = plan.groups.find((g) => g.workers > 1) ?? plan.groups[plan.groups.length - 1];
  if (g.workers > 1) g.workers--;
  else plan.groups.pop();
  sum = plan.groups.reduce((a, g) => a + g.workers, 0);
}
writeFileSync(resolve(OUT, "plan.json"), JSON.stringify(plan, null, 2));
log(`plan: ${plan.groups.map((g) => `${g.title} ×${g.workers}`).join(" | ")}`);

const leadsRoom = `${SWARM_ID}-leads`;
const groupRooms = plan.groups.map((g) => `${SWARM_ID}-${g.id}`);
const runs: Promise<{ name: string; text: string }>[] = [];
let codexLeft = CODEX;

// verifier joins the leads room first so it is present for every report
const verifierTools = ["mcp__chatroom__*", "Read", "Grep", "Glob", "Bash", ...(APPLY ? ["Edit", "Write"] : [])];
runs.push(
  runClaude(
    "verifier",
    prompt("verifier.md", {
      NAME: "verifier",
      AGENT: "claude",
      TOTAL,
      CWD,
      TASK: task,
      DONE_WHEN: plan.done_when,
      GROUP_LIST: plan.groups.map((g) => g.title).join("; "),
      VERIFIER_DIRECTIVE: plan.verifier_directive,
      LEADS_ROOM: leadsRoom,
      LEADS_N: plan.groups.length + 1,
      APPLY_CLAUSE: APPLY
        ? "You MAY modify files to apply the agreed fix on a new git branch and run the tests to prove it works; report the branch name in your vote."
        : "Do NOT modify any files; verify by reading and running read-only commands only.",
    }),
    verifierTools,
    CWD,
  ).then((text) => ({ name: "verifier", text })),
);

for (const g of plan.groups) {
  const room = `${SWARM_ID}-${g.id}`;
  for (let i = 1; i <= g.workers; i++) {
    const useCodex = codexLeft > 0 && i === g.workers && g.workers > 1; // codex never takes the lead seat
    if (useCodex) codexLeft--;
    const agent = useCodex ? "codex" : "claude";
    const name = `${g.id}-${agent}-${i}`;
    const isLead = i === 1;
    const vars = {
      NAME: name,
      AGENT: agent,
      TOTAL,
      CWD,
      TASK: task,
      DONE_WHEN: plan.done_when,
      GROUP_TITLE: g.title,
      DIRECTIVE: g.directive,
      ROOM: room,
      N: g.workers,
      ANON: String(ANON),
      LEADS_ROOM: leadsRoom,
      AFTER_CONCLUSION: isLead ? prompt("lead-tail.md", { LEADS_ROOM: leadsRoom, NAME: name, AGENT: agent, GROUP_TITLE: g.title }) : "`leave_room` and finish.",
    };
    const text = prompt("worker.md", vars);
    log(`launching ${name}${isLead ? " (lead)" : ""}`);
    runs.push((useCodex ? runCodex(name, text, CWD) : runClaude(name, text, ["mcp__chatroom__*", "Read", "Grep", "Glob", "Bash"], CWD)).then((t) => ({ name, text: t })));
  }
}

const tail = setInterval(() => tailRooms([...groupRooms, leadsRoom]), 2000);
const timeout = setTimeout(() => {
  log(`timeout after ${TIMEOUT_MIN} min; stopping agents`);
  for (const c of children) c.kill();
}, TIMEOUT_MIN * 60_000);

const results = await Promise.all(runs);
clearTimeout(timeout);
clearInterval(tail);
await tailRooms([...groupRooms, leadsRoom]);

// ---------- report ----------
const roomJson = async (room: string) => (await (await fetch(`${URL_}/rooms/${room}`)).json()) as { state: string; conclusion: { text: string } | null };
const transcript = async (room: string) => (await (await fetch(`${URL_}/rooms/${room}/transcript`)).text()).replace(/\n#/g, "\n\\#");
const leads = await roomJson(leadsRoom).catch(() => ({ state: "missing", conclusion: null }));
let report = `# ${SWARM_ID}\n\n**Task:** ${task}\n\n**Done when:** ${plan.done_when}\n\n## Final answer (${leads.state})\n\n${leads.conclusion?.text ?? "_no consensus reached_"}\n\n`;
report += `## Verifier\n\n${results.find((r) => r.name === "verifier")?.text ?? "(none)"}\n\n## Groups\n\n`;
for (const g of plan.groups) {
  const r = await roomJson(`${SWARM_ID}-${g.id}`).catch(() => ({ state: "missing", conclusion: null }));
  report += `### ${g.title} (${r.state})\n\n${r.conclusion?.text ?? "_no consensus_"}\n\n`;
}
report += `## Transcripts\n\n`;
for (const room of [leadsRoom, ...groupRooms]) report += "```\n" + (await transcript(room).catch(() => "(missing)")) + "```\n\n";
writeFileSync(resolve(OUT, "report.md"), report);

console.log("\n==================== FINAL ANSWER ====================");
console.log(leads.conclusion?.text ?? "NO CONSENSUS");
console.log("\n==================== VERIFIER ====================");
console.log(results.find((r) => r.name === "verifier")?.text ?? "(none)");
console.log(`\nreport: ${resolve(OUT, "report.md")}`);
process.exit(leads.conclusion ? 0 : 1);
