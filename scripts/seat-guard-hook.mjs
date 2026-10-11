#!/usr/bin/env node
// Claude Code PreToolUse hook on Bash for chatroom seats (wired by src/env.ts heartbeatHookSettings via --settings).
// Seats share one machine. In swarm-094251-5y46 a seat's `pkill -f fetch_trades.py` killed another seat's script of
// the same name three times, and a promise in chat to kill by PID did not hold: 26 more pkill commands followed. So
// the shell refuses it. Denied: pkill and killall, a kill fed by pgrep or by a pipe into xargs (the same match by
// command line), and a kill of a literal PID that another seat started (its env carries a different CHATROOM_SEAT_KEY).
// The denial names the replacement, scripts/seat-procs.mjs, which stops by the same pattern among this seat's own
// processes only. Everything else passes: no output, exit 0. A shell with no seat key is not a seat's and is left alone.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { seatKeyOf } from "./seat-procs.mjs";

const SEAT_PROCS = join(dirname(fileURLToPath(import.meta.url)), "seat-procs.mjs");
// where a shell starts reading a command: line start, after ; & | ( or a keyword, behind sudo/xargs/nohup, or as the string given to sh -c
const AT_COMMAND = String.raw`(?:^|[;&|(\n` + "`" + String.raw`]|\$\(|\b(?:then|do|else|sudo|exec|nohup|time)\s|\s-c\s+["'])\s*`;
const BY_NAME = new RegExp(AT_COMMAND + String.raw`(?:pkill|killall)\b([^;&|\n]*)`);
const BY_PGREP = new RegExp(AT_COMMAND + String.raw`kill\b[^;&|\n]*(?:\$\(|` + "`" + String.raw`)\s*pgrep\b`);
const BY_XARGS = /\|\s*xargs\b[^;&|\n]*\bkill\b/;
const BY_PID = new RegExp(AT_COMMAND + String.raw`kill((?:\s+-\S+)*)((?:\s+\d+)+)(?=\s*(?:$|[;&|)\n]))`, "g");

/** A heredoc's body is a file being written, not commands this shell runs. */
const withoutHeredocs = (command) => command.replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2(?=\n|$)/g, "$3");

/** Why this Bash command is refused, or null. */
export function refusal(command, key, keyOf = seatKeyOf) {
  const cmd = withoutHeredocs(command);
  const stop = (pattern) => `node ${JSON.stringify(SEAT_PROCS)} stop ${pattern}`;
  const named = BY_NAME.exec(cmd);
  if (named || BY_PGREP.test(cmd) || BY_XARGS.test(cmd)) {
    const pattern = named?.[1].trim().split(/\s+/).filter((w) => !w.startsWith("-")).pop()?.replace(/^["']|["']$/g, "");
    return `Refused: this kills by matching command lines, and other seats on this machine run processes whose names match yours (one seat's pkill killed another seat's script that way). Stop only what you started: \`${stop(pattern || "<pattern>")}\` matches the same way among your own processes and leaves everyone else's; \`node ${JSON.stringify(SEAT_PROCS)} list\` shows them. For a shell loop, keep its PID when you start it (\`... & echo $! > x.pid\`) and \`kill $(cat x.pid)\`.`;
  }
  const foreign = [];
  for (const m of cmd.matchAll(BY_PID)) for (const pid of m[2].trim().split(/\s+/)) {
    const owner = keyOf(Number(pid));
    if (owner && owner !== key) foreign.push(pid);
  }
  if (foreign.length) return `Refused: PID ${foreign.join(", ")} ${foreign.length === 1 ? "was" : "were"} started by another seat, not by you. \`node ${JSON.stringify(SEAT_PROCS)} list\` shows the processes you started; if another seat's process is in your way, ask that seat in the room.`;
  return null;
}

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  try {
    const ev = JSON.parse(raw || "{}");
    const key = process.env.CHATROOM_SEAT_KEY;
    const command = ev.tool_input?.command;
    if (key && ev.tool_name === "Bash" && typeof command === "string") {
      const permissionDecisionReason = refusal(command, key);
      if (permissionDecisionReason) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason } }));
    }
  } catch { /* a guard that cannot read the call lets it through: the seat's work matters more than this check */ }
  process.exit(0);
});
