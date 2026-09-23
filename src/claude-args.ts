/**
 * One place that builds the argv for every `claude -p` seat: the launcher's worker/verifier/planner
 * (src/swarm.ts runClaude) and the spawner's recruit path (src/spawner.ts) both call this, so the lean
 * flag set can't drift between the two call sites.
 *
 * Evidence (docs/token-round-0918.md): a Claude Code seat's first turn pays for Claude Code's own
 * system prompt, built-in tool definitions, and (when --setting-sources loads it) the operator's
 * skills, plugins and memory — none of which a chatroom seat uses. --setting-sources stays at
 * "project" rather than dropping settings entirely: a target repo's own .claude/ (hooks, project
 * skills) can be load-bearing for the task itself (e.g. this repo's decision-edit-guard hook).
 *
 * Auto-memory is not governed by --setting-sources: a lean seat still loaded the operator's per-project
 * MEMORY.md (swarm-092653-202z probe, haiku first turn: 12886 prompt tokens with it, 7378 without) and was
 * told to write to it. Every seat then starts anchored on the same prior-room conclusions, which undercuts
 * independent attempts, and each seat writes its own memory at exit (swarm-083203-kooz left 13 of the
 * index's 33 lines). Lean seats get autoMemoryEnabled:false in --settings; --claude-full keeps memory.
 */
export interface ClaudeArgsOptions {
  text: string;
  mcpJson: string;
  /** the --allowedTools list (may include mcp__* entries) */
  tools: string[];
  model?: string;
  /** --claude-full / CHATROOM_CLAUDE_FULL=1: restores today's flags, none of the lean additions below. */
  full?: boolean;
  /** "json" (default): a single blob printed only on clean exit. "stream-json": NDJSON emitted as the
   * seat works, so a caller that kills the process mid-run still has whatever was flushed before the
   * kill (bench-rq1.ts item 3 — usage must survive a kill, not just clean exits). Requires --verbose,
   * per the CLI's own refusal ("--output-format=stream-json requires --verbose", confirmed live). */
  outputFormat?: "json" | "stream-json";
  /** --settings JSON (src/env.ts heartbeatHookSettings): the seat's tool-call heartbeat hook. Kept under --claude-full too. */
  settings?: string;
}

/** --tools governs only the built-in tool set; it does not take MCP tool names (those are already scoped by --mcp-config --strict-mcp-config). */
const builtinOnly = (tools: string[]) => tools.filter((t) => !t.startsWith("mcp__"));

export function claudeArgs({ text, mcpJson, tools, model, full, outputFormat, settings }: ClaudeArgsOptions): string[] {
  const args = ["-p", text, "--mcp-config", mcpJson, "--strict-mcp-config", "--allowedTools", tools.join(",")];
  if (!full) {
    args.push("--tools", builtinOnly(tools).join(","), "--disable-slash-commands", "--setting-sources", "project", "--exclude-dynamic-system-prompt-sections");
  }
  if (outputFormat === "stream-json") args.push("--output-format", "stream-json", "--verbose");
  else args.push("--output-format", "json");
  if (model) args.push("--model", model);
  const merged = full ? settings : JSON.stringify({ ...(settings ? JSON.parse(settings) : {}), autoMemoryEnabled: false });
  if (merged) args.push("--settings", merged);
  return args;
}
