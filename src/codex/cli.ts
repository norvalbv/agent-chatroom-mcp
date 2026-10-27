import { runCodexLive } from "./live.js";
import { codexUsageTracker } from "../codex-seat.js";
import { writeFileSync } from "node:fs";

// The wrapper accepts the existing exec argv so both launchers share sandbox/MCP option construction.
const args = process.argv.slice(2);
const value = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const urlOption = args.find((arg) => arg.startsWith("mcp_servers.chatroom.url="));
if (!urlOption) throw new Error("Codex seat requires a chatroom MCP URL");
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
const usageFile = value("--usage-sidecar");
const track = usageFile ? codexUsageTracker((usage) => {
  try { writeFileSync(usageFile, JSON.stringify(usage)); } catch (error) { console.error(`Codex usage sidecar: ${String(error)}`); }
}) : undefined;
const emit = (event: unknown) => {
  const line = JSON.stringify(event) + "\n";
  track?.(line);
  if (args.includes("--json")) process.stdout.write(line);
};
// codexArgs' -s and its sandbox_workspace_write.* overrides: the mode goes to thread/start, the overrides to app-server
const sandbox = value("-s") as "read-only" | "workspace-write" | undefined;
const scope = args.flatMap((arg, i) => (args[i - 1] === "-c" && arg.startsWith("sandbox_workspace_write.") ? ["-c", arg] : []));
const roots = scope.find((arg) => arg.startsWith("sandbox_workspace_write.writable_roots="));
// telemetry: which sandbox this seat ran, in its event stream (the launcher's <name>.events.jsonl)
emit({ type: "seat.sandbox", mode: sandbox ?? "inherited", writable_roots: roots ? JSON.parse(roots.slice(roots.indexOf("=") + 1)) : [], network: scope.includes("sandbox_workspace_write.network_access=true") });
try {
  const final = await runCodexLive({ cwd: value("-C") ?? process.cwd(), mcpUrl: JSON.parse(urlOption.split("=").slice(1).join("=")), model: value("-m"), readOnly: sandbox === "read-only", sandbox, configArgs: scope, outFile: value("-o"), prompt, emit });
  if (!value("-o")) process.stdout.write(final + "\n");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
