#!/usr/bin/env node
/**
 * Swarm orchestrator: one command that turns "get N agents to solve X" into
 * plan -> sub-rooms of workers -> leads room -> verifier with veto -> report.
 *
 *   npx tsx src/swarm.ts "<task>" --agents 6 --cwd /path/to/project [--codex 2] [--apply] [--timeout 30]
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
const BOOL_FLAGS = new Set(["--apply", "--full-access", "--named"]);
const task = argv.find((a, i) => !a.startsWith("--") && (i === 0 || !argv[i - 1].startsWith("--") || BOOL_FLAGS.has(argv[i - 1])));
if (!task) {
  console.error('usage: swarm "<task>" [--agents 6] [--cwd dir] [--models sonnet,haiku] [--lead-model opus] [--verifier-model opus] [--planner-model opus] [--codex k] [--codex-models gpt-6-astra,gpt-5.6-sol,gpt-5.6-terra] [--apply] [--full-access] [--named] [--timeout 30] [--port 7717]');
  process.exit(2);
}
const TOTAL = Math.max(2, Number(flag("agents", "4")));
const WORKERS = TOTAL - 1; // one seat is the verifier
const CWD = resolve(flag("cwd", process.cwd())!);
const CODEX = Math.min(WORKERS, Number(flag("codex", "0")));
const APPLY = has("apply");
const ANON = !has("named"); // worker rooms are anonymous unless --named
const LENSES = ["reproduce and measure before theorising", "the simplest fix that could work", "what could go wrong with the obvious fix", "what the tests and history say", "the maintainer who inherits this in a year"];
const FULL = has("full-access");
// model mix: --models sonnet,sonnet,haiku (rotated over workers), --lead-model, --verifier-model, --planner-model
const MODELS = (flag("models", process.env.CLAUDE_MODEL ?? "") || "").split(",").map((m) => m.trim()).filter(Boolean);
const LEAD_MODEL = flag("lead-model", MODELS[0]);
const VERIFIER_MODEL = flag("verifier-model", LEAD_MODEL);
const PLANNER_MODEL = flag("planner-model", VERIFIER_MODEL);
// Codex seats: --codex k spreads k workers over --codex-models (rotated), default the current OpenAI line-up
const CODEX_MODELS = (flag("codex-models", process.env.CODEX_MODELS ?? process.env.CODEX_MODEL ?? "gpt-6-astra,gpt-5.6-sol,gpt-5.6-terra") || "").split(",").map((m) => m.trim()).filter(Boolean);
let codexIndex = 0; // workers may edit files and run anything; each gets its own git worktree
const READ_TOOLS = ["mcp__chatroom__*", "Read", "Grep", "Glob", "Bash", "WebSearch", "WebFetch"];
const WRITE_TOOLS = [...READ_TOOLS, "Edit", "Write", "MultiEdit", "NotebookEdit"];
const TIMEOUT_MIN = Number(flag("timeout", "30"));
const PORT = Number(flag("port", process.env.PORT ?? "7717"));
const URL_ = `http://127.0.0.1:${PORT}`;
const SWARM_ID = `swarm-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}-${Math.random().toString(36).slice(2, 6)}`;
const OUT = resolve(repoRoot, "swarms", SWARM_ID);
mkdirSync(OUT, { recursive: true });

const log = (s: string) => console.log(`\x1b[2m[${new Date().toISOString().slice(11, 19)}]\x1b[0m ${s}`);
const prompt = (file: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((s, [k, v]) => s.split(`{{${k}}}`).join(String(v)), readFileSync(resolve(repoRoot, "prompts", file), "utf8"));

// ---------- settled axes (devkit decision log) ----------
/**
 * If the target project keeps a devkit decision log (docs/decisions/*.md), every agent is told what is
 * already settled and which sources have already been read, so research is not repeated and a reversal
 * has to be argued as a re-target with new evidence.
 */
function settledAxes(cwd: string): string {
  const dir = resolve(cwd, "docs", "decisions");
  if (!existsSync(dir)) return "";
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "INDEX.md");
  if (!files.length) return "";
  const rows: string[] = [];
  const sources = new Set<string>();
  for (const f of files) {
    const t = readFileSync(resolve(dir, f), "utf8");
    const title = /^## Target[^\n]*— ([^\n]+)/m.exec(t)?.[1] ?? f.replace(/\.md$/, "");
    const ruling = /\*\*(?:Ruling|Decision)[^*]*\*\*:?\s*([^\n]+)/i.exec(t)?.[1] ?? "";
    rows.push(`- ${f.replace(/\.md$/, "")}: ${title.replace(/\*/g, "").trim()}${ruling ? ` — ${ruling.trim().slice(0, 240)}` : ""}`);
    for (const id of t.match(/arXiv:[a-z-]*\/?[0-9]{4}\.[0-9]{4,5}|arXiv:cs\/[0-9]{7}|10\.[0-9]{4,}\/[^ ),;]+/g) ?? []) sources.add(id);
  }
  return (
    "SETTLED AXES (this project's decision log, docs/decisions/; do NOT re-research or re-argue these; cite them by slug. " +
    "If you find evidence that contradicts one, say so explicitly as 'RE-TARGET <slug>: <evidence>' rather than silently deciding differently):\n" +
    rows.join("\n") +
    "\n\nSOURCES ALREADY READ (do not re-fetch or re-summarise; new research must add sources not in this list): " +
    [...sources].sort().join(", ") +
    "\n"
  );
}

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

function runClaude(name: string, text: string, tools: string[], cwd: string, model?: string): Promise<string> {
  const outFile = resolve(OUT, `${name}.out`);
  const args = ["-p", text, "--mcp-config", mcpJson, "--strict-mcp-config", "--allowedTools", tools.join(",")];
  if (model) args.push("--model", model);
  return runProc(name, "claude", args, cwd, outFile);
}

function runCodex(name: string, text: string, cwd: string, model?: string): Promise<string> {
  const outFile = resolve(OUT, `${name}.out`);
  const args = ["exec", "--skip-git-repo-check", "-C", cwd, "-c", `mcp_servers.chatroom.url="${URL_}/mcp"`, "-c", "mcp_servers.chatroom.tool_timeout_sec=120", "-o", outFile];
  if (model) args.push("-m", model);
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

/** With --full-access, give each worker its own git worktree so parallel edits cannot collide. */
const isGitRepo = spawnSync("git", ["-C", CWD, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" }).stdout?.trim() === "true";
const readOnlyWorkers = new Set<string>();
function workerCwd(name: string): string {
  if (!FULL || !isGitRepo) return CWD;
  const dir = resolve(CWD, ".swarm-worktrees", SWARM_ID, name);
  const branch = `swarm/${SWARM_ID}/${name}`;
  const r = spawnSync("git", ["-C", CWD, "worktree", "add", "-b", branch, dir], { encoding: "utf8" });
  if (r.status !== 0) {
    log(`worktree for ${name} failed (${r.stderr.trim()}); ${name} will run READ-ONLY in ${CWD}`);
    readOnlyWorkers.add(name);
    return CWD;
  }
  log(`${name} works in ${dir} (branch ${branch})`);
  return dir;
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
const SETTLED = settledAxes(CWD);
if (SETTLED) log(`decision log found: ${SETTLED.split("\n").length - 4} settled axes injected into every prompt`);
const planRaw = await runClaude("planner", prompt("planner.md", { TASK: task, CWD, WORKERS, MAX_GROUPS: Math.max(1, Math.floor(WORKERS / 2)) }) + "\n\n" + SETTLED, READ_TOOLS.filter((t) => !t.startsWith("mcp__")), CWD, PLANNER_MODEL);
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
let workerIndex = 0;

// verifier joins the leads room first so it is present for every report
const verifierTools = APPLY || FULL ? WRITE_TOOLS : READ_TOOLS;
runs.push(
  runClaude(
    "verifier",
    SETTLED + "\n" + prompt("verifier.md", {
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
      APPLY_CLAUSE:
        APPLY || FULL
          ? "You MAY modify files to apply the agreed fix on a new git branch and run the tests to prove it works; report the branch name in your vote." +
            (FULL && isGitRepo ? ` Workers may have committed on branches named swarm/${SWARM_ID}/<name>; inspect and merge or cherry-pick from them as needed.` : "")
          : "Do NOT modify any files; verify by reading and running read-only commands only.",
    }),
    verifierTools,
    CWD,
    VERIFIER_MODEL,
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
      LENS: LENSES[(i - 1) % LENSES.length],
      LEADS_ROOM: leadsRoom,
      AFTER_CONCLUSION: isLead ? prompt("lead-tail.md", { LEADS_ROOM: leadsRoom, NAME: name, AGENT: agent, GROUP_TITLE: g.title }) : "`leave_room` and finish.",
    };
    const wcwd = workerCwd(name);
    const text = SETTLED + "\n" + prompt("worker.md", {
      ...vars,
      CWD: wcwd,
      WRITE_RULE:
        FULL && !readOnlyWorkers.has(name)
          ? `You MAY modify files and run anything; you are on your own git branch in ${wcwd}. Commit what you want the verifier to test and say so in the room.`
          : "Do NOT modify any files.",
    });
    const model = useCodex ? CODEX_MODELS[codexIndex++ % Math.max(1, CODEX_MODELS.length)] : isLead ? LEAD_MODEL : MODELS.length ? MODELS[workerIndex++ % MODELS.length] : undefined;
    log(`launching ${name}${isLead ? " (lead)" : ""}${model ? ` [${model}]` : ""}`);
    runs.push((useCodex ? runCodex(name, text, wcwd, model) : runClaude(name, text, FULL && !readOnlyWorkers.has(name) ? WRITE_TOOLS : READ_TOOLS, wcwd, model)).then((t) => ({ name, text: t })));
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
if (FULL && isGitRepo) console.log(`worker branches: git -C "${CWD}" branch --list "swarm/${SWARM_ID}/*"   (worktrees under .swarm-worktrees/${SWARM_ID}/)`);
console.log(`\nreport: ${resolve(OUT, "report.md")}`);
process.exit(leads.conclusion ? 0 : 1);
