/** RQ1 harness mode (paper/protocol.md section 1): runs one (task, arm, seed) on real Claude seats.
 * Arm A: one claude seat, no chatroom tools, the task brief plus a minimal "where to put your answer"
 * scaffold. Arm C: a chatroom room on a hub this script starts, the fixed seat count for the task, the
 * full hub surface (challenge + verification on). Both launch seats through claudeArgs() so the only
 * difference between arms is the arm itself, per item 1's requirement. Both arms run
 * --output-format stream-json (item 3): a seat killed at the deadline still leaves whatever it streamed
 * before the kill, instead of losing its usage entirely to a clean-exit-only json blob.
 *
 * node --import tsx scripts/bench-rq1.ts TASK_DIR ARM SEED --root DIR [--model sonnet] [--port N]
 *   [--seats N] [--timeout-ms N, default 900000] [--max-budget-usd N] [--deadline-ms N] [--hub-entry PATH]
 *
 * ARM is A or C. Fixtures stay hidden exactly as scripts/bench-bench.ts already does (public/ copied
 * into workspace/, oracle/ and fixtures/ never copied); scoring is the *unmodified*
 * scripts/bench-oracle.ts scoreTask(), so a change here cannot silently change what counts as a pass.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, lstatSync, cpSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { createServer } from "node:net";
import { pathToFileURL, fileURLToPath } from "node:url";
import { claudeArgs } from "../src/claude-args.js";
import { parseClaudeCliOutput, rollupUsage, type SeatUsageRollup } from "../src/result.js";
import { seatChildEnv } from "../src/env.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");

function hashTree(path: string): string {
  const hash = createHash("sha256");
  const visit = (p: string) => {
    const st = lstatSync(p);
    if (st.isSymbolicLink()) throw new Error(`Symlink not permitted: ${p}`);
    if (st.isDirectory()) for (const name of readdirSync(p).sort()) visit(join(p, name));
    else if (st.isFile()) {
      hash.update(relative(path, p));
      hash.update("\0");
      hash.update(readFileSync(p));
      hash.update("\0");
    }
  };
  visit(path);
  return hash.digest("hex");
}
function hashFile(path: string): string | null {
  return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null;
}
function revision(dir: string): string | null {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise<void>((ok) => child.once("exit", () => ok())), delay(500)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await Promise.race([new Promise<void>((ok) => child.once("exit", () => ok())), delay(500)]);
  }
}

// Item 5 (orphans): the hub and every claude seat are tracked here so a SIGINT/SIGTERM/uncaught exit of
// this script kills them too, instead of leaving them reparented to pid 1. `exit` handlers must be
// synchronous, so this issues SIGKILL directly rather than the graceful stop() above.
const trackedChildren = new Set<ChildProcess>();
function track(child: ChildProcess): ChildProcess {
  trackedChildren.add(child);
  child.once("exit", () => trackedChildren.delete(child));
  return child;
}
process.on("exit", () => {
  for (const child of trackedChildren) {
    if (child.exitCode === null && child.signalCode === null && child.pid) {
      try {
        child.kill("SIGKILL");
      } catch {}
    }
  }
});
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

/** Token signal salvaged from `--output-format stream-json` messages seen before a seat was killed —
 * item 3: claude's real cost figure (`total_cost_usd`) only exists on the final `result` event, so a
 * killed seat's cost genuinely stays unknown (usage:null, exactly as an unmodified clean-exit failure
 * already reads), but the per-turn token counts on `type:"assistant"` events do survive a kill and are
 * worth keeping as forensic signal distinct from the authoritative `usage` field. */
export interface PartialUsage {
  output_tokens: number;
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  assistant_messages_observed: number;
}

export interface SeatRecord {
  name: string;
  argv: string[];
  exit_code: number | null;
  signal: string | null;
  started_at: string;
  completed_at: string;
  text: string;
  usage: SeatUsageRollup | null;
  num_turns: number | null;
  duration_ms: number | null;
  duration_api_ms: number | null;
  stderr_tail: string;
  /** true only when *our* deadline timer sent the kill signal, distinct from any other exit/signal. */
  killed_by_deadline: boolean;
  /** Non-null only when the seat was killed before a `result` event arrived but at least one
   * `assistant` event was observed first; null (not zero-filled) otherwise. */
  partial_usage: PartialUsage | null;
  /** CLI-reported identifiers, not an attestation of provider weights or reasoning settings. */
  reported_models: { system_init: string[]; assistant: string[]; result_model_usage: string[] } | null;
  /** Unmodified terminal CLI usage by model, including reasoning fields when reported. */
  model_usage: Record<string, unknown> | null;
}

/** Spawn one `claude` seat (bare command name, resolved off PATH so tests can stub it); enforce a wall-clock cap since the CLI has no such flag itself.
 * Seats run with `--output-format stream-json` (see src/claude-args.ts): stdout is NDJSON, one event per
 * line, so a kill mid-run still leaves every event flushed before the kill on disk/in the buffer — a
 * clean-exit-only `--output-format json` blob loses everything to a SIGTERM (item 3). */
function runClaudeSeat(name: string, args: string[], cwd: string, deadlineMs: number): Promise<SeatRecord> {
  return new Promise((res) => {
    const startedAt = new Date();
    const child = track(spawn("claude", args, { cwd, env: seatChildEnv(process.env, name), stdio: ["ignore", "pipe", "pipe"] }));
    let buffered = "";
    let resultLine: string | null = null;
    let err = "";
    const partial: PartialUsage = { output_tokens: 0, assistant_messages_observed: 0 };
    const models = { system_init: new Set<string>(), assistant: new Set<string>(), result_model_usage: new Set<string>() };
    const observeModel = (source: keyof typeof models, value: unknown) => {
      if (typeof value === "string" && value.trim()) models[source].add(value);
    };
    let killedByDeadline = false;
    const consumeLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let evt: any;
      try {
        evt = JSON.parse(trimmed);
      } catch {
        return;
      }
      // Identity observations must survive usage-free events and a missing terminal result.
      if (evt?.type === "system" && evt.subtype === "init") observeModel("system_init", evt.model);
      if (evt?.type === "assistant") observeModel("assistant", evt.message?.model);
      if (evt?.type === "result") {
        if (evt.modelUsage && typeof evt.modelUsage === "object" && !Array.isArray(evt.modelUsage)) {
          for (const id of Object.keys(evt.modelUsage)) observeModel("result_model_usage", id);
        }
        resultLine = trimmed;
        return;
      }
      if (evt?.type === "assistant" && evt.message?.usage) {
        const u = evt.message.usage;
        partial.assistant_messages_observed += 1;
        if (typeof u.output_tokens === "number") partial.output_tokens += u.output_tokens;
        if (typeof u.input_tokens === "number") partial.input_tokens = u.input_tokens;
        if (typeof u.cache_read_input_tokens === "number") partial.cache_read_input_tokens = u.cache_read_input_tokens;
        if (typeof u.cache_creation_input_tokens === "number") partial.cache_creation_input_tokens = u.cache_creation_input_tokens;
      }
    };
    child.stdout?.on("data", (d) => {
      buffered += d;
      let idx: number;
      while ((idx = buffered.indexOf("\n")) >= 0) {
        consumeLine(buffered.slice(0, idx));
        buffered = buffered.slice(idx + 1);
      }
    });
    child.stderr?.on("data", (d) => (err += d));
    const killer = setTimeout(() => {
      killedByDeadline = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 2000).unref();
    }, deadlineMs);
    child.on("close", (code, signal) => {
      clearTimeout(killer);
      if (buffered.trim()) consumeLine(buffered);
      const completedAt = new Date();
      const raw = (resultLine ?? "").trim();
      const { text, usage } = parseClaudeCliOutput(raw);
      let parsed: any = null;
      try {
        parsed = resultLine ? JSON.parse(resultLine) : null;
      } catch {}
      res({
        name,
        argv: ["claude", ...args],
        exit_code: code,
        signal,
        started_at: startedAt.toISOString(),
        completed_at: completedAt.toISOString(),
        text,
        usage,
        num_turns: typeof parsed?.num_turns === "number" ? parsed.num_turns : null,
        duration_ms: typeof parsed?.duration_ms === "number" ? parsed.duration_ms : null,
        duration_api_ms: typeof parsed?.duration_api_ms === "number" ? parsed.duration_api_ms : null,
        stderr_tail: err.slice(-4000),
        killed_by_deadline: killedByDeadline,
        partial_usage: !resultLine && partial.assistant_messages_observed > 0 ? partial : null,
        reported_models: Object.values(models).some((ids) => ids.size)
          ? { system_init: [...models.system_init], assistant: [...models.assistant], result_model_usage: [...models.result_model_usage] }
          : null,
        model_usage: parsed?.modelUsage && typeof parsed.modelUsage === "object" && !Array.isArray(parsed.modelUsage) ? parsed.modelUsage : null,
      });
    });
  });
}

/** Last `state:concluded` record in a room's jsonl log, or null (mirrors bench/seat/real-seat.mjs's own extraction). */
function roomConclusion(logPath: string): { text: string } | null {
  if (!existsSync(logPath)) return null;
  const events = readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
  const found = [...events].reverse().find((e) => e.type === "state" && e.state === "concluded" && typeof e.conclusion?.text === "string");
  return found ? { text: found.conclusion.text } : null;
}

async function main() {
  const argv = process.argv.slice(2);
  const taskArg = argv.shift();
  const armArg = argv.shift();
  const seedArg = argv.shift();
  if (!taskArg || (armArg !== "A" && armArg !== "C") || seedArg === undefined) {
    throw new Error("Usage: bench-rq1.ts TASK_DIR ARM(A|C) SEED --root DIR [--model sonnet] [--port N] [--seats N] [--timeout-ms N] [--max-budget-usd N] [--deadline-ms N] [--hub-entry PATH]");
  }
  const seed = Number(seedArg);
  if (!Number.isInteger(seed)) throw new Error(`Invalid seed: ${seedArg}`);
  const flag = (name: string, def?: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : def;
  };
  const model = flag("model", "sonnet")!;
  const rootArg = flag("root");
  if (!rootArg) throw new Error("--root is required");
  const root = resolve(rootArg);
  if (existsSync(root)) throw new Error(`Refusing to reuse ${root}`);
  const port = Number(flag("port", "19850"));
  if (!Number.isInteger(port) || port <= 8000 || port > 65534) throw new Error("Invalid port: use integer port >8000 and <=65534");
  const seats = Math.max(1, Number(flag("seats", "3")));
  // Item 4 (paper/amendments.md): the old 300000ms default left a 3-seat room with blind openings only
  // ~150s for any real work — bench-bug-fix-C-seed1's own reveal alone (data/rq1.jsonl timestamps) took
  // 139s. 900000ms (15min) budgets for that reveal plus edit/propose/challenge/verify-command round trips.
  const timeoutMs = Number(flag("timeout-ms", "900000"));
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error("Invalid --timeout-ms");
  const maxBudgetUsd = flag("max-budget-usd");
  const deadlineMs = Number(flag("deadline-ms", String(timeoutMs)));
  const hubEntry = resolve(flag("hub-entry", resolve(repoRoot, "dist/index.js"))!);

  const taskDir = realpathSync(resolve(taskArg));
  const scorerPath = resolve(here, "bench-oracle.ts");
  const factScorerPath = resolve(dirname(scorerPath), "score-fact-check.ts");
  const scorer = await import(pathToFileURL(scorerPath).href);
  const task = scorer.loadTask(taskDir);
  const taskBefore = hashTree(taskDir);
  const scorerBefore = hashFile(scorerPath);
  const factScorerBefore = hashFile(factScorerPath);
  const isCodeTask = task.oracle.kind !== "exact-answer";
  const briefText = readFileSync(join(taskDir, "public", "brief.txt"), "utf8");

  if (armArg === "C") {
    for (const p of [port]) {
      const probe = createServer();
      await new Promise<void>((ok, no) => {
        probe.once("error", no);
        probe.listen(p, "127.0.0.1", () => probe.close(() => ok()));
      });
    }
  }

  mkdirSync(root, { recursive: true });
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  cpSync(join(taskDir, "public"), workspace, { recursive: true, errorOnExist: true, force: false });

  const scaffoldSingle = isCodeTask
    ? "Modify the relevant source file(s) in your current working directory directly to implement the fix described above. Your edit to the existing file(s) is the submission; do not create any other output file."
    : "Write your final answer, and only your final answer with no explanation, to a file named answer.txt in your current working directory.";
  const scaffoldRoom = isCodeTask
    ? "Modify the relevant source file(s) in this shared working directory directly; when the room reaches a proposal you agree with, its text should summarize the fix, but the file edits are the submission."
    : "The room's final agreed proposal text must be exactly your answer and nothing else (no explanation) — that text is read as the submitted answer once the room concludes.";

  let seatRecords: SeatRecord[] = [];
  let startedAt = new Date();
  let completedAt = new Date();
  const build = {
    captured_at: new Date().toISOString(), head_revision: revision(repoRoot), runner_sha256: null as string | null,
    hub_entry: armArg === "C" ? hubEntry : null, hub_entry_sha256: null as string | null,
    hub_revision: null as string | null, hub_build_sha256: null as string | null, provenance_scope: null as string | null,
  };
  // Any thrown error below (hub boot failure, room-create failure, mid-run tamper) still produces a
  // written verdict, matching bench-bench.ts's try/catch/finally convention: a crash with no artifact
  // is indistinguishable from a run that was never attempted, which is worse for the grid runner (item
  // 5) than a recorded infrastructure_error/tamper outcome.
  let failureReason: "infrastructure_error" | "tamper" | null = null;
  let failureMessage: string | null = null;
  // Item 1 (swarm-125438-jp20): both arms must see the same built-in tools; the chatroom mcp tools are
  // arm C's only addition on top of this shared list (claudeArgs()'s --tools strips mcp__* entries, so
  // --tools is exactly baseTools on both arms).
  const baseTools = isCodeTask ? ["Read", "Edit", "Write", "MultiEdit", "Bash", "Glob", "Grep"] : ["Read", "Write", "Bash", "Glob", "Grep"];

  try {
  // Snapshot before launching any child. Scope excludes dependencies and later file mutations;
  // this records launch provenance, not an immutable execution environment.
  build.runner_sha256 = hashFile(fileURLToPath(import.meta.url));
  if (armArg === "C") {
    build.hub_revision = revision(dirname(hubEntry));
    build.hub_entry_sha256 = hashFile(hubEntry);
    const isDist = dirname(hubEntry).endsWith("/dist");
    build.provenance_scope = isDist ? "dist-tree; external dependencies not covered" : "entry-only; imported modules not covered";
    if (existsSync(hubEntry)) build.hub_build_sha256 = isDist ? hashTree(dirname(hubEntry)) : build.hub_entry_sha256;
  }
  if (armArg === "A") {
    startedAt = new Date();
    const mcpJson = join(root, "mcp-empty.json");
    json(mcpJson, { mcpServers: {} });
    const text = `${briefText}\n${scaffoldSingle}`;
    const args = claudeArgs({ text, mcpJson, tools: baseTools, model, outputFormat: "stream-json" });
    if (maxBudgetUsd) args.push("--max-budget-usd", maxBudgetUsd);
    seatRecords = [await runClaudeSeat("single", args, workspace, deadlineMs)];
    completedAt = new Date();
  } else {
    startedAt = new Date();
    const dataDir = join(root, "data");
    mkdirSync(dataDir, { recursive: true });
    const hubEnv = { ...process.env };
    for (const key of Object.keys(hubEnv)) if (key.startsWith("CHATROOM_") || /API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)) delete hubEnv[key];
    // Item 2 (swarm-125438-jp20): a benchmark hub must refuse recruitment outright, in addition to (not
    // instead of) stripping provider keys above — src/index.ts's loadDotEnv() would otherwise silently
    // refill a deleted OPENROUTER_API_KEY from the repo's .env, and CHATROOM_NO_RECRUIT=1 both stops that
    // reload (src/index.ts) and makes every request_agent call fail closed (src/spawner.ts), regardless.
    Object.assign(hubEnv, { PORT: String(port), HOST: "127.0.0.1", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_NO_RECRUIT: "1", CHATROOM_DATA_DIR: dataDir, CHATROOM_DEFAULT_CWD: workspace, CHATROOM_LOG_DIR: join(root, "spawned") });
    const fd = openSync(join(root, "hub.log"), "w");
    const hubChild = track(spawn(process.execPath, [hubEntry], { cwd: workspace, env: hubEnv, stdio: ["ignore", fd, fd] }));
    const url = `http://127.0.0.1:${port}`;
    let ready = false;
    let hubVersion: string | null = null;
    const readyDeadline = Date.now() + Math.min(30000, deadlineMs);
    let spawnError: Error | undefined;
    hubChild.on("error", (e) => (spawnError = e));
    while (Date.now() < readyDeadline) {
      if (spawnError) break;
      if (hubChild.exitCode !== null) break;
      try {
        const r = await fetch(`${url}/rooms`, { signal: AbortSignal.timeout(1000) });
        if (r.ok) {
          ready = true;
          const v = (await r.json()) as { version?: string };
          hubVersion = v.version ?? null;
          break;
        }
      } catch {}
      await delay(50);
    }
    if (!ready) {
      await stop(hubChild);
      closeSync(fd);
      throw new Error(spawnError ? String(spawnError) : hubChild.exitCode !== null ? `Hub exited ${hubChild.exitCode}` : "Hub did not become ready");
    }
    void hubVersion;
    const room = "rq1";
    const created = await fetch(`${url}/rooms/${room}/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic: briefText, expected_participants: seats, quorum: "supermajority", require_challenge: true, require_verification: true }),
    });
    if (!created.ok) {
      await stop(hubChild);
      closeSync(fd);
      throw new Error(`Room create HTTP ${created.status}`);
    }
    const mcpJson = join(root, "mcp.json");
    json(mcpJson, { mcpServers: { chatroom: { type: "http", url: `${url}/mcp` } } });
    const tools = ["mcp__chatroom__*", ...baseTools];
    const seatPromises: Promise<SeatRecord>[] = [];
    for (let i = 1; i <= seats; i++) {
      const name = `seat-${i}`;
      const text = `${briefText}\n${scaffoldRoom}\n\nJoin room ${room} as ${name} (agent claude, expected_participants ${seats}). Leave the room once it has concluded.`;
      const args = claudeArgs({ text, mcpJson, tools, model, outputFormat: "stream-json" });
      seatPromises.push(runClaudeSeat(name, args, workspace, deadlineMs));
    }
    seatRecords = await Promise.all(seatPromises);
    completedAt = new Date();
    const conclusion = roomConclusion(join(dataDir, `${room}.jsonl`));
    await stop(hubChild);
    closeSync(fd);
    if (conclusion && !isCodeTask) writeFileSync(join(workspace, "answer.txt"), conclusion.text);
  }

    if (hashTree(taskDir) !== taskBefore || hashFile(scorerPath) !== scorerBefore || hashFile(factScorerPath) !== factScorerBefore) {
      failureReason = "tamper";
    }
  } catch (error) {
    completedAt = new Date();
    failureMessage = String(error);
    failureReason = /tamper/i.test(failureMessage) ? "tamper" : "infrastructure_error";
  }

  // Re-hash regardless of the branch above: a failure path may still have left the fixture touched,
  // and a clean run's anti_tamper record must reflect the real post-run state either way.
  const after = hashTree(taskDir);
  const unchanged = after === taskBefore && hashFile(scorerPath) === scorerBefore && hashFile(factScorerPath) === factScorerBefore;
  // Item 3 (paper/amendments.md): a seat our own deadline killed never got a fair attempt — even when the
  // workspace happens to look untouched/correct, scoring it would misrepresent a cut-off run as a pass or
  // fail. "timeout" is already in the five-outcome vocabulary (docs/decisions/measure-task-success-on-a-
  // machine-oracle.md) but nothing produced it; this is the first producer, checked ahead of scoreTask.
  const killedByDeadline = seatRecords.some((s) => s.killed_by_deadline);
  const scored =
    !failureReason && !killedByDeadline && unchanged
      ? await scorer.scoreTask(taskDir, workspace)
      : { passed: false, reason: failureReason ?? (killedByDeadline ? "timeout" : "tamper"), oracle: { kind: task.oracle.kind, command: null, exit_code: null } };
  const outcome = !unchanged ? "tamper" : (failureReason ?? (killedByDeadline ? "timeout" : scored.reason));
  const passed = unchanged && !failureReason && !killedByDeadline && scored.passed;

  const usage = rollupUsage(seatRecords.map((s) => ({ usage: s.usage })));
  const turnsKnown = seatRecords.filter((s) => typeof s.num_turns === "number");
  const result = {
    schemaVersion: 1,
    task_id: task.task_id,
    arm: armArg,
    seed,
    model,
    outcome,
    passed,
    reason: outcome,
    oracle: scored.oracle,
    anti_tamper: { hash_before: taskBefore, hash_after: after, unchanged },
    // `text` is the seat's own final response (exactly what --output-format text would have printed),
    // kept alongside the scored outcome so a parse_failure/task_fail can be told apart after the fact:
    // did the seat compute the right answer and simply not write it where the scorer looked
    // (instruction-following/format failure) or never solve the task at all (reasoning failure)?
    seats: seatRecords.map((s) => ({ name: s.name, argv: s.argv, exit_code: s.exit_code, signal: s.signal, started_at: s.started_at, completed_at: s.completed_at, num_turns: s.num_turns, duration_ms: s.duration_ms, duration_api_ms: s.duration_api_ms, usage: s.usage, text: s.text, killed_by_deadline: s.killed_by_deadline, partial_usage: s.partial_usage, reported_models: s.reported_models, model_usage: s.model_usage })),
    usage,
    turns: { per_seat: seatRecords.map((s) => ({ name: s.name, num_turns: s.num_turns })), summed: turnsKnown.reduce((a, s) => a + (s.num_turns ?? 0), 0), seats: seatRecords.length, seats_with_turns: turnsKnown.length, coverage: turnsKnown.length === 0 ? "none" : turnsKnown.length === seatRecords.length ? "complete" : "partial" },
    wall_clock: { started_at: startedAt.toISOString(), completed_at: completedAt.toISOString(), duration_ms: completedAt.getTime() - startedAt.getTime() },
    budget: armArg === "A" ? { max_budget_usd: maxBudgetUsd ? Number(maxBudgetUsd) : null, deadline_ms: deadlineMs } : null,
    build,
    frozen: { task_sha256: taskBefore, scorer_sha256: scorerBefore, fact_scorer_sha256: factScorerBefore, task_id: task.task_id, timeout_ms: timeoutMs, seats: armArg === "C" ? seats : 1 },
    error: failureMessage,
    checked_at: new Date().toISOString(),
  };
  json(join(root, "result.json"), result);
  console.log(root);
}

main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
