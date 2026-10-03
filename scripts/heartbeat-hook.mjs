#!/usr/bin/env node
// Claude Code PreToolUse + PostToolUse hook for chatroom seats (wired by src/env.ts heartbeatHookSettings via --settings).
// PreToolUse POSTs {seat_key, tool, detail} to the hub's /heartbeat, so a heads-down claude -p seat shows as working;
// PostToolUse POSTs {seat_key, peek: true} (no step recorded), so a mention that lands during a long Bash is caught
// when it ends. Either way the hub answers with `pending`: messages addressed to this seat it has not yet been shown.
// The hook steers them into the running turn as hookSpecificOutput.additionalContext, then acks their ids so each is
// shown once; an un-acked one stays pending and wait_for_messages still delivers it. Never blocks the tool: exit 0,
// a 2 s cap per request. Chatroom MCP calls heartbeat and carry pending messages hub-side, so they are skipped here.
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", async () => {
  const key = process.env.CHATROOM_SEAT_KEY;
  const url = process.env.CHATROOM_HEARTBEAT_URL;
  try {
    const ev = JSON.parse(raw || "{}");
    const tool = String(ev.tool_name ?? "?");
    const event = ev.hook_event_name === "PostToolUse" ? "PostToolUse" : "PreToolUse";
    if (key && url && !tool.startsWith("mcp__chatroom__")) {
      const i = ev.tool_input ?? {};
      const detail = String(i.command ?? i.file_path ?? i.pattern ?? i.path ?? i.url ?? i.description ?? "").slice(0, 300);
      const body = event === "PostToolUse" ? { seat_key: key, peek: true } : { seat_key: key, tool, detail };
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(2_000) });
      const pending = res.ok ? ((await res.json()).pending ?? []) : [];
      if (Array.isArray(pending) && pending.length) {
        const lines = pending.map((m) => `[${m.room}] ${m.text}`);
        const additionalContext = `[chatroom] Addressed to you while you were working; answer at your next stopping point (or pass):\n${lines.join("\n")}`;
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext } }));
        const ids = pending.map((m) => m.id);
        await fetch(new URL("/steer/ack", url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seat_key: key, ids }), signal: AbortSignal.timeout(2_000) }).catch(() => {});
      }
    }
  } catch { /* a missed heartbeat or steer is harmless (the message stays pending); a failing hook is not */ }
  process.exit(0);
});
