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
 */
export interface ClaudeArgsOptions {
  text: string;
  mcpJson: string;
  /** the --allowedTools list (may include mcp__* entries) */
  tools: string[];
  model?: string;
  /** --claude-full / CHATROOM_CLAUDE_FULL=1: restores today's flags, none of the lean additions below. */
  full?: boolean;
}

/** --tools governs only the built-in tool set; it does not take MCP tool names (those are already scoped by --mcp-config --strict-mcp-config). */
const builtinOnly = (tools: string[]) => tools.filter((t) => !t.startsWith("mcp__"));

export function claudeArgs({ text, mcpJson, tools, model, full }: ClaudeArgsOptions): string[] {
  const args = ["-p", text, "--mcp-config", mcpJson, "--strict-mcp-config", "--allowedTools", tools.join(",")];
  if (!full) {
    args.push("--tools", builtinOnly(tools).join(","), "--disable-slash-commands", "--setting-sources", "project", "--exclude-dynamic-system-prompt-sections");
  }
  args.push("--output-format", "json");
  if (model) args.push("--model", model);
  return args;
}
