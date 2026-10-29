#!/usr/bin/env node
// Claude Code PreToolUse hook on Bash for chatroom seats (wired by src/env.ts heartbeatHookSettings via --settings).
// Seats share one machine. In swarm-094251-5y46 a seat's `pkill -f fetch_trades.py` killed another seat's script of
// the same name three times, and a promise in chat to kill by PID did not hold: 26 more pkill commands followed. So
// the shell refuses it. Denied: pkill and killall, a kill fed by pgrep, by a loop over pgrep's output or by a pipe into
// xargs (the same match by command line; a pipe from lsof alone picks by port and passes), and a kill of a literal PID
// that another seat started (its env carries a different CHATROOM_SEAT_KEY). It stops a habit, not an adversary:
// `P=pkill; $P -f x` or a kill written into a script file gets through.
// The denial names the replacement, scripts/seat-procs.mjs, which stops by the same pattern among this seat's own
// processes only, and is posted to the hub as a step (tool "seat-guard") so the room's record counts refusals.
// Everything else passes: no output, exit 0. A shell with no seat key is not a seat's and is left alone.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { seatKeyOf } from "./seat-procs.mjs";

const SEAT_PROCS = join(dirname(fileURLToPath(import.meta.url)), "seat-procs.mjs");
// where a shell starts reading a command: line start, after ; & | ( or a keyword, behind sudo/xargs/nohup, or as the string given to sh -c
const AT_COMMAND = String.raw`(?:^|[;&|(\n` + "`" + String.raw`]|\$\(|\b(?:then|do|else|sudo|exec|nohup|time)\s|\s-\w*c\s+["']|\beval\s+["'])\s*`;
const BY_NAME = new RegExp(AT_COMMAND + String.raw`(?:pkill|killall)\b([^;&|\n]*)`);
const BY_PGREP = new RegExp(AT_COMMAND + String.raw`kill\b[^;&|\n]*(?:\$\(|` + "`" + String.raw`)\s*pgrep\b`);
const BY_XARGS = /\|\s*xargs\b[^;&|\n]*\bkill\b/;
// a pipeline that picks its PIDs by port alone (`lsof -ti:7810 -sTCP:LISTEN | xargs kill`): the way a seat stops its own private hub
const BY_PORT = /(?:^|[;&(\n]|&&|\|\|)\s*lsof\b[^;&|\n]*\|\s*xargs\b[^;&|\n]*\bkill\b/;
// PIDs looked up by name anywhere in the command (pgrep other than of a PID file, or ps piped to grep) ...
const LOOKUP = /\bpgrep\b(?!\s+(?:-\w+\s+)*-F\b)|\bps\b[^;&\n]*\|\s*(?:grep|awk)\b/;
// ... and a kill whose target is a variable or a substitution other than a PID file or a port
const KILL_VAR = new RegExp(AT_COMMAND + String.raw`kill\b(?:\s+-\S+)*\s+(?!\$\(\s*(?:cat\b|<|lsof\b))["']?[$` + "`" + String.raw`]`);
const BY_PID = new RegExp(AT_COMMAND + String.raw`kill((?:\s+-\S+)*)((?:\s+\d+)+)(?=\s*(?:$|[;&|)\n]))`, "g");

/** A heredoc's body is a file being written, not commands this shell runs. */
const withoutHeredocs = (command) => command.replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2(?=\n|$)/g, "$3");

/** A quoted string is text (a commit message, a note that says "Stop: pkill -f x"), not commands, unless it is the
 * script handed to a shell (`sh -c '...'`, `bash -lc "..."`) or to eval: those are kept, everything else is emptied.
 * Double-quoted substitutions are kept too, since `kill "$(pgrep -f x)"` runs one. */
const SHELL_ARG = /(?:\b(?:ba|z|da|k)?sh\b(?:\s+-\w+)*\s+-\w*c|\beval)\s+$/;
function withoutQuotedText(command, keepHubPaths = false) {
  return command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, (q, at) => {
    if (SHELL_ARG.test(command.slice(0, at))) return q;
    if (keepHubPaths && /(?:^|\/)hubd\.(?:js|ts)$/.test(q.slice(1, -1))) return q;
    if (q[0] === "'") return "''";
    return `"${(q.match(/\$\([^)]*\)|`[^`]*`|\$\{?\w+\}?/g) ?? []).join(" ")}"`;
  });
}

// A git command that skips the repository's commit hooks: --no-verify, commit's -n, HUSKY=0, or core.hooksPath pointed
// away. Not refused (whether a seat may is the owner's policy): recorded, so a room's record counts bypasses. Chatroom
// seats ran 152 such commands in 24 sessions on this machine, one disclosed (evidence/seat-hooks-cost-and-bypass).
const GIT_HOOKED = String.raw`git\b(?:\s+-[cC]\s+\S+)*\s+(?:commit|push|merge|rebase|cherry-pick|am|revert)\b`;
const BYPASS = [
  new RegExp(AT_COMMAND + GIT_HOOKED + String.raw`[^;&|\n]*\s--no-verify\b`),
  new RegExp(AT_COMMAND + String.raw`git\b(?:\s+-[cC]\s+\S+)*\s+commit\b[^;&|\n]*\s-[a-zA-Z]*n[a-zA-Z]*\b`),
  new RegExp(AT_COMMAND + String.raw`(?:\w+=\S*\s+)*HUSKY=0\s+(?:\w+=\S*\s+)*` + GIT_HOOKED),
  new RegExp(AT_COMMAND + String.raw`git\b(?:\s+-[cC]\s+\S+)*\s+-c\s+core\.hooks[Pp]ath=\S*`),
];

/** The bypass this command makes, as typed, or null. Quoted text and heredocs are not commands. */
export function hookBypass(command) {
  const cmd = withoutQuotedText(withoutHeredocs(command));
  return BYPASS.some((re) => re.test(cmd)) ? command.slice(0, 280) : null;
}

/** Why this Bash command is refused, or null. */
export function refusal(command, key, keyOf = seatKeyOf) {
  const cmd = withoutQuotedText(withoutHeredocs(command));
  const hubs = withoutQuotedText(withoutHeredocs(command), true);
  const runtime = new RegExp(AT_COMMAND + String.raw`(?:env\s+)?(?:\w+=\S*\s+)*(?:\S*\/)?(?:node|tsx|npx\s+(?:--yes\s+)?tsx)\s+([^;&|\n]*)`, "g");
  for (const m of hubs.matchAll(runtime)) {
    const args = (m[1].match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(s => s.replace(/^['"]|['"]$/g, ""));
    const script = args.findIndex(s => /(?:^|\/)hubd\.(?:js|ts)$/.test(s));
    if (script >= 0 && args.slice(script + 1).includes("--always")) return "Refused: a seat's test hub must not use --always, which restarts a listener after a deliberate stop. Omit --always, keep the supervisor PID, and stop only the private hub you started.";
  }
  const stop = (pattern) => `node ${JSON.stringify(SEAT_PROCS)} stop ${pattern}`;
  const named = BY_NAME.exec(cmd);
  const byXargs = BY_XARGS.test(cmd) && !(BY_PORT.test(cmd) && !BY_XARGS.test(cmd.replace(new RegExp(BY_PORT.source, "g"), ";")));
  if (named || BY_PGREP.test(cmd) || byXargs || (LOOKUP.test(cmd) && KILL_VAR.test(cmd))) {
    // the seat's own pattern, quotes and all, from the command as typed (the quoted text was emptied for the match)
    const typed = new RegExp(AT_COMMAND + String.raw`(?:pkill|killall)((?:\s+-\w+)*)\s+("[^"]*"|'[^']*'|[^\s;&|]+)`).exec(withoutHeredocs(command));
    const pattern = named && typed?.[2];
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
process.stdin.on("end", async () => {
  try {
    const ev = JSON.parse(raw || "{}");
    const key = process.env.CHATROOM_SEAT_KEY;
    const command = ev.tool_input?.command;
    if (key && ev.tool_name === "Bash" && typeof command === "string") {
      const bypass = refusal(command, key) ? null : hookBypass(command);
      if (bypass) {
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "[chatroom] This git command skips the repository's commit hooks (its gates). It runs, and the bypass is recorded in the room's record; say in the room why the hooks were skipped." } }));
        const url = process.env.CHATROOM_HEARTBEAT_URL;
        if (url) await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seat_key: key, tool: "seat-guard", detail: `bypassed hooks: ${bypass}` }), signal: AbortSignal.timeout(3_000) }).catch(() => {});
      }
      const permissionDecisionReason = refusal(command, key);
      if (permissionDecisionReason) {
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason } }));
        // the refusal is a step in the room's record (tool "seat-guard"), so a room can count them
        const url = process.env.CHATROOM_HEARTBEAT_URL;
        if (url) await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seat_key: key, tool: "seat-guard", detail: `refused: ${command.slice(0, 280)}` }), signal: AbortSignal.timeout(2_000) }).catch(() => {});
      }
    }
  } catch { /* a guard that cannot read the call lets it through: the seat's work matters more than this check */ }
  process.exit(0);
});
