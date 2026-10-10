/** The work ledger: what the hub can count behind a proposal. A seat's process reports every local tool call
 * (scripts/heartbeat-hook.mjs, the codex launcher, src/seat.ts); the hub classes each one, keeps the counts on the
 * participant and in the room log (a "work" event with its time), and states them when someone proposes. Before this
 * the beats were dropped after the last 60, so no room could say how much it read or searched before it concluded. */
import type { Participant, Room, WorkClass, WorkCounts } from "./types.js";

const CLASSES: WorkClass[] = ["read", "search", "web", "run", "edit"];
const REMOTE_FETCH = /\b(curl|wget|gh\s+api|git\s+clone)\b/;
const LOCAL_URL = /https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/;
const READ = /^(read|notebookread|read_file|view)$/;
const SEARCH = /^(grep|glob|ls|search_files|list_dir)$/;
const WEB = /^(websearch|webfetch|web_search|web_fetch|fetch_url)$/;
const EDIT = /^(edit|write|notebookedit|multiedit|write_file|apply_patch)$/;
const RUN = /^(bash|shell|run_command|exec)$/;
/** env assignments and a leading `cd dir &&` before the command a shell call really runs */
const SHELL_PREFIX = /^(\s*(\w+=("[^"]*"|'[^']*'|\S*)\s+|cd\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)\s*))*/;
const SHELL_SEARCH = /^(grep|rg|find|fd|ls|tree|git\s+(grep|log|ls-files|branch|status))\b/;
const SHELL_READ = /^(cat|head|tail|less|wc|jq|sed\s+-n|awk|git\s+(show|diff|blame))\b/;
const NOT_FINDINGS = /^(claim|draft|inbox|hold)\//;

/** The class of a local tool call, or undefined for anything that is not one (chatroom tools, launcher lines). */
export function workClass(tool: string, detail = ""): WorkClass | undefined {
  const t = String(tool).toLowerCase();
  if (t.startsWith("mcp__chatroom__")) return undefined;
  if (READ.test(t)) return "read";
  if (SEARCH.test(t)) return "search";
  if (WEB.test(t)) return "web";
  if (EDIT.test(t)) return "edit";
  if (RUN.test(t)) return shellClass(detail);
  return undefined;
}

/** Seats do most of their reading through the shell (cat, grep, curl), so a shell call is classed by the command it starts with. */
function shellClass(command: string): WorkClass {
  if (REMOTE_FETCH.test(command) && !LOCAL_URL.test(command)) return "web";
  const first = command.replace(SHELL_PREFIX, "");
  if (SHELL_SEARCH.test(first)) return "search";
  if (SHELL_READ.test(first)) return "read";
  return "run";
}

const URL_HOST = /https?:\/\/([^\s/"')]+)/;
const seen = new WeakMap<Participant, Set<string>>();

/**
 * Count one local call toward a seat's ledger if its target is new: the file, the pattern, the command, or for the
 * web the host. Forty `ls` calls on one directory are one piece of work, and the room log gets one line per distinct
 * target instead of one per call. Returns the target when it counted (the caller persists it), undefined when not.
 */
export function countWork(p: Participant, cls: WorkClass, detail = ""): string | undefined {
  const text = detail.replace(/\s+/g, " ").trim();
  const target = ((cls === "web" && URL_HOST.exec(text)?.[1]) || text).slice(0, 120);
  const mine = seen.get(p) ?? new Set<string>();
  seen.set(p, mine);
  if (mine.has(`${cls} ${target}`)) return undefined;
  mine.add(`${cls} ${target}`);
  p.work = { ...p.work, [cls]: (p.work?.[cls] ?? 0) + 1 };
  return target;
}

/** A seat whose process is known to report each local tool call: it has been counted, or it is a claude seat with a
 * heartbeat key (the tool hook). A codex seat's key beats on output and an openrouter seat has none, so for them
 * nothing counted means unknown, never zero. */
const reports = (p: Participant) => !!p.work || (!!p.seatKeyHash && p.agent === "claude");

const total = (w: WorkCounts | undefined) => CLASSES.reduce((n, c) => n + (w?.[c] ?? 0), 0);
const line = (w: WorkCounts | undefined) => CLASSES.filter((c) => w?.[c]).map((c) => `${c} ${w?.[c]}`).join(", ") || "none";

/** Claims whose owner has put nothing else on the board: an area somebody took and nobody reported on. */
export function barrenClaims(room: Room, seats: Participant[]): string[] {
  const names = new Set(seats.map((p) => p.name));
  const wrote = new Set([...room.board].filter(([k]) => !NOT_FINDINGS.test(k)).map(([, e]) => e.by));
  return [...room.board].filter(([k, e]) => k.startsWith("claim/") && names.has(e.by) && !wrote.has(e.by)).map(([k, e]) => `${k} (${e.by})`);
}

/**
 * What is thin right now, as one clause for the hint of a seat that owes a challenge: seats with no local tool call,
 * a room where nobody left the machine, claims with no findings. Undefined when nothing is thin or nobody reports.
 */
export function evidenceGaps(room: Room, voters: Participant[], shown: (p: Participant) => string = (p) => p.name): string | undefined {
  const reporting = voters.filter(reports);
  if (!reporting.length) return undefined;
  const idle = reporting.filter((p) => !total(p.work)).map(shown);
  const barren = barrenClaims(room, voters);
  const gaps = [
    idle.length ? `${idle.join(", ")} made no local tool call` : "",
    reporting.some((p) => p.work?.web) ? "" : "no seat made a web call",
    barren.length ? `${barren.join(", ")} ${barren.length === 1 ? "has" : "have"} no findings on the board` : "",
  ].filter(Boolean);
  return gaps.length ? gaps.join("; ") : undefined;
}

/**
 * One hub-written line for a new proposal: how long the room has run, each reporting seat's local tool calls by class,
 * how many seats did none or never left the machine, and the claims with no findings. Undefined when no voter's
 * process reports local work (a seat not started by a launcher has no heartbeat key), since zeros would then be noise.
 */
export function evidenceReceipt(room: Room, voters: Participant[], shown: (p: Participant) => string = (p) => p.name): string | undefined {
  const reporting = voters.filter(reports);
  if (!reporting.length) return undefined;
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(room.createdAt)) / 60_000));
  const idle = reporting.filter((p) => !total(p.work)).length;
  const offline = reporting.filter((p) => !p.work?.web).length;
  const barren = barrenClaims(room, voters);
  const silent = voters.length - reporting.length;
  return `EVIDENCE BEHIND THIS PROPOSAL, ${minutes} min after the room opened. Distinct local targets since joining (files, patterns, commands, web hosts): ` +
    `${reporting.map((p) => `${shown(p)}: ${line(p.work)}`).join("; ")}. ` +
    `${idle} of ${reporting.length} seats made no local tool call; ${offline} of ${reporting.length} made no web call.` +
    (barren.length ? ` Claims whose owner has no findings on the board: ${barren.join(", ")}.` : "") +
    (silent ? ` ${silent} seat${silent === 1 ? " does" : "s do"} not report local work: unknown, not zero.` : "");
}
