#!/usr/bin/env node
// Claude Code PreToolUse hook for chatroom seats (wired by src/env.ts heartbeatHookSettings via --settings): each local
// tool call POSTs {seat_key, tool, detail} to the hub's /heartbeat, so a heads-down claude -p seat shows as working.
// Never blocks the tool: no output, always exit 0, a 2 s cap on the request. Chatroom MCP calls heartbeat hub-side.
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", async () => {
  const key = process.env.CHATROOM_SEAT_KEY;
  const url = process.env.CHATROOM_HEARTBEAT_URL;
  try {
    const ev = JSON.parse(raw || "{}");
    const tool = String(ev.tool_name ?? "?");
    if (key && url && !tool.startsWith("mcp__chatroom__")) {
      const i = ev.tool_input ?? {};
      const detail = String(i.command ?? i.file_path ?? i.pattern ?? i.path ?? i.url ?? i.description ?? "").slice(0, 300);
      await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seat_key: key, tool, detail }), signal: AbortSignal.timeout(2_000) });
    }
  } catch { /* a missed heartbeat is harmless; a failing hook is not */ }
  process.exit(0);
});
