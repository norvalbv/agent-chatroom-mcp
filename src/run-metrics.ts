/**
 * Run metrics computed from the hub's own room log (data/<room>.jsonl), which the hub appends as events happen. Round 1
 * computed its headline numbers (recruit rate, minutes to first proposal, share of seat time spent polling) by hand in
 * a seat's private script, and lost the run's numbers when the launcher crashed; this reads only what the hub wrote, so
 * it works on any past room, a crashed run, or a live one (GET /rooms/<room>/metrics).
 * Work counts are the ledger's DISTINCT targets per class (src/hub/work.ts), not tool calls as OpenTelemetry's
 * gen_ai.invoke_agent.tool_calls counts them. Anything the log does not carry is undefined (unknown), never zero.
 */
import { spawnSync } from "node:child_process";
import type { WorkClass } from "./hub/types.js";
import { coordinates } from "./hub/keys.js";

const CLASSES: WorkClass[] = ["read", "search", "web", "run", "edit"];
const SHA = /\b[0-9a-f]{7,40}\b/g;
const NOT_CREDIT = { test: (key: string) => coordinates(key) || key.startsWith("draft/") };
const WAIT = "wait_for_messages";

export interface SeatMetrics {
  name: string;
  role: string;
  agent: string;
  /** MCP tool calls the hub completed for this seat, by tool */
  calls: Record<string, number>;
  /** distinct local targets by class, from the hub's work ledger; undefined when the log has no ledger at all (a hub
   * before b62f5cc0, or no seat whose process reports tool calls) */
  work?: Record<WorkClass, number>;
  /** total ms spent in wait_for_messages, and the part that ended with nothing new; undefined when the log has no durations */
  waitMs?: number;
  idleWaitMs?: number;
  /** waitMs (idleWaitMs) over the seat's time in the room, joined to left or the room's last event */
  pollingShare?: number;
  idlePollingShare?: number;
  recruits: number;
  /** the seat process's own usage, latest cumulative "usage" event (claude-opus-5-5-1's live usage); absent: unknown */
  usage?: { requests?: number; input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; cost_usd?: number };
  /** what the seat's processes held (hub "memory" events): the highest sample, and the hub's warnings and stops; absent: never sampled */
  memory?: { peak_mb: number; warns: number; stops: number; ended?: number; /** past the no-budget mark (memory "high" events) */ highs?: number };
  proposals: number;
  challenges: number;
  votes: number;
  verifies: number;
  /** board entries other than claim/draft/inbox/hold */
  findings: number;
  /** board keys and commits of this seat that the conclusion (or the last open proposal) cites */
  cited: string[];
}

export interface RunMetrics {
  room: string;
  createdAt?: string;
  lastEventAt?: string;
  /** minutes after the room opened; absent when it never happened */
  minutesTo: { firstClaim?: number; firstSource?: number; firstProposal?: number; conclusion?: number };
  /** rate: workers who recruited at least once over workers; calls counts every role's recruits (a verifier's too) */
  recruits: { calls: number; seats: number; workers: number; rate: number };
  /** summed over seats that reported usage; seatsWithUsage of seats.length says how complete it is */
  usage?: { cost_usd: number; input_tokens: number; output_tokens: number; seatsWithUsage: number };
  /** take/<what> steps by action (hub "take" events): take, offer, accept, handover, release, decline, withdraw, refused, and refused:<reason> (held, same-commit, assigned-reviewer, already-reviewed); absent: none */
  takes?: Record<string, number>;
  /** agent chat by delivery: quiet the sender chose, quiet the hub chose (autoQuiet), and two-seat exchanges kept public because they named a board key; absent: no agent chat */
  quiet?: { chat: number; bySender: number; byHub: number; keptPublicForBoardKey: number };
  /** board_set(append=true) lines per shared key (hub "board_append" events): appends, distinct appenders, continuations used; absent: none */
  appends?: Record<string, { lines: number; seats: number; continuations: number }>;
  /** seats with at least one web call in the ledger; undefined when the log has no ledger */
  webSeats?: number;
  /** text the citation credit was read from */
  citedFrom: "conclusion" | "proposal" | "none";
  /** seats with findings on the board that the cited text never credits */
  uncited: string[];
  seats: SeatMetrics[];
}

type Ev = Record<string, any>;
export interface MetricsOptions {
  /** git author of a commit (seats commit under their own name: src/env.ts seatGitIdentity); undefined when unknown */
  shaAuthor?: (sha: string) => string | undefined;
}

const KEY_CHAR = /[\w./-]/;
/** The text names the key as a whole token: "notes" is not cited by "footnotes", nor "findings/a" by "findings/ab". */
function citesKey(text: string, key: string): boolean {
  for (let i = text.indexOf(key); i >= 0; i = text.indexOf(key, i + 1)) {
    const before = text[i - 1] ?? " ";
    const after = text[i + key.length] ?? " ";
    // a trailing full stop or slash ends a sentence or a path, not the key
    if (!KEY_CHAR.test(before) && (!KEY_CHAR.test(after) || /[./]/.test(after) && !KEY_CHAR.test(text[i + key.length + 1] ?? " "))) return true;
  }
  return false;
}

const minutes = (from: string | undefined, to: string | undefined) =>
  from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 6_000) / 10 : undefined;

export function runMetrics(events: readonly Ev[], opts: MetricsOptions = {}): RunMetrics {
  let room = "";
  let createdAt: string | undefined;
  let lastEventAt: string | undefined;
  const seats = new Map<string, SeatMetrics & { id: string; joinedAt?: string; leftAt?: string; durations: boolean }>();
  const byName = new Map<string, string>();
  const firstAt: { claim?: string; source?: string; proposal?: string; conclusion?: string } = {};
  const boardBy = new Map<string, string>();
  const shaFirst = new Map<string, string>();
  let conclusion: string | undefined;
  let proposal: string | undefined;
  let ledger = false;
  const takes: Record<string, number> = {};
  const quiet = { chat: 0, bySender: 0, byHub: 0, keptPublicForBoardKey: 0 };
  const appendsBy = new Map<string, { lines: number; seats: Set<string>; landed: Set<string> }>();
  const proposals = new Set<string>();
  const byKey = new Map<string, string>();

  const seat = (id: string | null | undefined, name?: string) => {
    if (!id) return undefined;
    let s = seats.get(id);
    if (!s && name) {
      s = { id, name, role: "worker", agent: "unknown", calls: {}, work: { read: 0, search: 0, web: 0, run: 0, edit: 0 }, recruits: 0, proposals: 0, challenges: 0, votes: 0, verifies: 0, findings: 0, cited: [], durations: true };
      seats.set(id, s);
      byName.set(name, id);
    }
    return s;
  };
  const named = (name: string | undefined) => (name ? seats.get(byName.get(name) ?? "") : undefined);
  const mention = (text: unknown, name: string | undefined) => {
    if (!name || name === "system" || typeof text !== "string") return;
    for (const sha of text.match(SHA) ?? []) if (/[a-f]/.test(sha) && !shaFirst.has(sha)) shaFirst.set(sha, name);
  };
  const stamp = (ts: unknown) => { if (typeof ts === "string" && (!lastEventAt || ts > lastEventAt)) lastEventAt = ts; };

  for (const e of events) {
    switch (e.type) {
      case "room":
        room ||= e.room;
        createdAt ??= e.createdAt;
        stamp(e.createdAt);
        break;
      case "join": {
        if (e.p?.agent === "human") break;
        const s = seat(e.p?.id, e.p?.name)!;
        s.role = e.p.role ?? "worker";
        s.agent = e.p.agent ?? "unknown";
        s.joinedAt ??= e.p.joinedAt;
        if (e.p.seatKeyHash) byKey.set(e.p.seatKeyHash, s.id);
        s.leftAt = undefined;
        stamp(e.p.joinedAt);
        break;
      }
      case "leave": {
        const s = seat(e.p?.id);
        if (s) s.leftAt = e.p.leftAt ?? lastEventAt;
        stamp(e.p?.leftAt);
        break;
      }
      case "call_completion": {
        stamp(e.ts);
        const s = seat(e.participant);
        if (!s) break;
        s.calls[e.tool] = (s.calls[e.tool] ?? 0) + 1;
        if (e.tool === "request_agent" && e.outcome === "success") s.recruits++;
        if (e.tool === WAIT) {
          if (typeof e.ms !== "number") { s.durations = false; break; }
          s.waitMs = (s.waitMs ?? 0) + e.ms;
          if (e.empty === true) s.idleWaitMs = (s.idleWaitMs ?? 0) + e.ms;
          else s.idleWaitMs ??= 0;
        }
        break;
      }
      case "usage": {
        // cumulative per seat process: the latest event wins, events are never summed
        stamp(e.ts);
        const s = seat(byKey.get(e.seat));
        if (s && e.usage) s.usage = e.usage;
        break;
      }
      case "memory": {
        stamp(e.ts);
        const s = seat(byKey.get(e.seat));
        if (!s) break;
        const m = (s.memory ??= { peak_mb: 0, warns: 0, stops: 0 });
        m.peak_mb = Math.max(m.peak_mb, Number(e.memory?.peak_mb ?? e.mb ?? 0));
        if (e.event === "warn") m.warns++;
        if (e.event === "stop") m.stops++;
        if (e.event === "ended") m.ended = (m.ended ?? 0) + 1;
        if (e.event === "high") m.highs = (m.highs ?? 0) + 1;
        break;
      }
      case "take":
        stamp(e.ts);
        takes[String(e.action)] = (takes[String(e.action)] ?? 0) + 1;
        // why a take was refused before the work: held (same key), same-commit (another spelling), assigned-reviewer
        if (e.action === "refused" && e.reason) takes[`refused:${String(e.reason)}`] = (takes[`refused:${String(e.reason)}`] ?? 0) + 1;
        break;
      case "board_append": {
        stamp(e.ts);
        const a = appendsBy.get(String(e.key)) ?? { lines: 0, seats: new Set<string>(), landed: new Set<string>() };
        a.lines++; a.seats.add(String(e.by)); if (e.landed_key !== e.key) a.landed.add(String(e.landed_key));
        appendsBy.set(String(e.key), a);
        break;
      }
      case "work": {
        stamp(e.ts);
        const s = seat(e.pid);
        ledger = true;
        if (s?.work && CLASSES.includes(e.cls)) s.work[e.cls as WorkClass]++;
        break;
      }
      case "board": {
        const entry = e.entry;
        stamp(entry?.updatedAt);
        if (!entry) break;
        const key = String(e.key);
        if (key.startsWith("claim/")) firstAt.claim ??= entry.updatedAt;
        if (key.startsWith("sources/")) firstAt.source ??= entry.updatedAt;
        mention(entry.text, entry.by);
        if (boardBy.has(key)) break; // a key is credited to whoever wrote it first; updates are not counted again
        boardBy.set(key, entry.by);
        const s = named(entry.by);
        if (!s) break;
        if (key.startsWith("verify/")) s.verifies++;
        if (!NOT_CREDIT.test(key)) s.findings++;
        break;
      }
      case "message": {
        const m = e.msg ?? {};
        stamp(m.ts);
        if (m.kind === "chat") mention(m.content, m.from?.name);
        if (m.kind === "chat" && m.from?.agent !== "hub" && m.from?.agent !== "human") {
          quiet.chat++;
          if (m.autoQuiet) quiet.byHub++; else if (m.quiet) quiet.bySender++;
          if (m.keptPublic === "board-key") quiet.keptPublicForBoardKey++;
        }
        break;
      }
      case "proposal": {
        const p = e.proposal ?? {};
        firstAt.proposal ??= p.createdAt;
        stamp(p.createdAt);
        proposal = p.text;
        // the hub persists a proposal again when its status changes (accepted at the conclusion): count each id once
        if (proposals.has(p.id)) break;
        proposals.add(p.id);
        const s = seat(p.by?.id);
        if (s) s.proposals++;
        break;
      }
      case "amend":
        stamp(e.updatedAt);
        proposal = e.text;
        break;
      case "challenge": {
        stamp(e.challenge?.ts);
        const s = seat(e.challenge?.by?.id);
        if (s) s.challenges++;
        break;
      }
      case "vote": {
        stamp(e.entry?.ts);
        const s = seat(e.pid);
        if (s) s.votes++;
        break;
      }
      case "state":
        if (e.conclusion) {
          conclusion = e.conclusion.text;
          firstAt.conclusion ??= e.conclusion.decidedAt;
          stamp(e.conclusion.decidedAt);
        }
        break;
    }
  }

  // citation credit: board keys the cited text names go to the key's first writer; a commit goes to its git author,
  // or, when the repo does not know it, to whoever first named it in chat or on the board
  const cited = conclusion ?? proposal;
  if (cited) {
    for (const [key, by] of boardBy) if (!NOT_CREDIT.test(key) && citesKey(cited, key)) named(by)?.cited.push(key);
    for (const sha of new Set(cited.match(SHA) ?? [])) {
      // an all-digit token is a commit only if git knows it (6217618 in swarm-085449-i9fk); otherwise it is a number
      const known = opts.shaAuthor?.(sha);
      if (!/[a-f]/.test(sha) && known === undefined) continue;
      const author = known ?? shaFirst.get(sha);
      named(author)?.cited.push(sha);
    }
  }

  const list = [...seats.values()].map(({ id: _id, joinedAt, leftAt, durations, ...s }) => {
    const life = joinedAt ? Date.parse(leftAt ?? lastEventAt ?? joinedAt) - Date.parse(joinedAt) : 0;
    if (!ledger) delete s.work;
    if (!durations) { delete s.waitMs; delete s.idleWaitMs; }
    else if (life > 0 && s.waitMs !== undefined) {
      s.pollingShare = s.waitMs / life;
      if (s.idleWaitMs !== undefined) s.idlePollingShare = s.idleWaitMs / life;
    }
    return s as SeatMetrics;
  });
  const workers = list.filter((s) => s.role === "worker");
  const priced = list.filter((s) => s.usage);
  const sum = (k: "cost_usd" | "input_tokens" | "output_tokens") => priced.reduce((n, s) => n + (s.usage?.[k] ?? 0), 0);
  const recruiting = workers.filter((s) => s.recruits > 0).length;
  return {
    room,
    createdAt,
    lastEventAt,
    minutesTo: Object.fromEntries(Object.entries({
      firstClaim: minutes(createdAt, firstAt.claim),
      firstSource: minutes(createdAt, firstAt.source),
      firstProposal: minutes(createdAt, firstAt.proposal),
      conclusion: minutes(createdAt, firstAt.conclusion),
    }).filter(([, v]) => v !== undefined)) as RunMetrics["minutesTo"],
    recruits: { calls: list.reduce((n, s) => n + s.recruits, 0), seats: recruiting, workers: workers.length, rate: workers.length ? recruiting / workers.length : 0 },
    ...(priced.length ? { usage: { cost_usd: sum("cost_usd"), input_tokens: sum("input_tokens"), output_tokens: sum("output_tokens"), seatsWithUsage: priced.length } } : {}),
    ...(Object.keys(takes).length ? { takes } : {}),
    ...(quiet.chat ? { quiet } : {}),
    ...(appendsBy.size ? { appends: Object.fromEntries([...appendsBy].map(([k, a]) => [k, { lines: a.lines, seats: a.seats.size, continuations: a.landed.size }])) } : {}),
    ...(ledger ? { webSeats: list.filter((s) => (s.work?.web ?? 0) > 0).length } : {}),
    citedFrom: conclusion ? "conclusion" : proposal ? "proposal" : "none",
    uncited: cited ? list.filter((s) => s.findings > 0 && !s.cited.length).map((s) => s.name) : [],
    seats: list,
  };
}

/** Parse a room log file's text (one JSON event per line; unreadable lines are skipped, as the hub's replay does). */
export function parseRoomLog(text: string): Ev[] {
  return text.split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

/** input tokens including cache reads and writes (Anthropic's input_tokens excludes them; OTel's gen_ai.usage.input_tokens includes them) */
const tokens = (u: NonNullable<SeatMetrics["usage"]>) => (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
const pct = (x: number | undefined) => (x === undefined ? "?" : `${Math.round(x * 100)}%`);
const at = (m: number | undefined, what: string) => (m === undefined ? `no ${what}` : `${what} ${m} min`);

/** Seat memory in one sentence, or nothing when the log has no memory events (a hub before src/hub/memory.ts). */
function memoryLine(seats: SeatMetrics[]): string {
  const sampled = seats.filter((s) => s.memory);
  if (!sampled.length) return "";
  const stops = sampled.reduce((n, s) => n + s.memory!.stops, 0);
  return `Peak memory of what each seat started: ${sampled.sort((a, b) => b.memory!.peak_mb - a.memory!.peak_mb).map((s) => `${s.name} ${s.memory!.peak_mb} MB`).join(", ")}; the hub stopped ${stops} process${stops === 1 ? "" : "es"} over budget. `;
}

/** The metrics as a report section: one headline line, then one row per seat. */
export function renderMetrics(m: RunMetrics): string {
  const t = m.minutesTo;
  let text = `## Metrics\n\nComputed from the hub's room log (${m.room}). ${[at(t.firstClaim, "first claim"), at(t.firstSource, "first source"), at(t.firstProposal, "first proposal"), at(t.conclusion, "conclusion")].join(", ")}. ` +
    `${m.recruits.seats} of ${m.recruits.workers} workers recruited (${pct(m.recruits.rate)}); ${m.recruits.calls} recruit${m.recruits.calls === 1 ? "" : "s"} by any seat, see the recruits column; ` +
    (m.webSeats === undefined ? "no work ledger in this log, so reads, searches and web calls are unknown. " : `${m.webSeats} of ${m.seats.length} seats made a web call. `) +
    (m.usage ? `Seat-reported usage: $${m.usage.cost_usd.toFixed(2)}, ${m.usage.input_tokens} input + ${m.usage.output_tokens} output tokens from ${m.usage.seatsWithUsage} of ${m.seats.length} seats (the rest unknown). ` : "No seat reported usage to the hub. ") +
    memoryLine(m.seats) +
    (m.quiet && (m.quiet.bySender || m.quiet.byHub || m.quiet.keptPublicForBoardKey) ? `Of ${m.quiet.chat} agent chat messages, ${m.quiet.bySender} were sent quiet, ${m.quiet.byHub} were made quiet by the hub, and ${m.quiet.keptPublicForBoardKey} two-seat exchanges stayed public because they named a board entry. ` : "") +
    (m.takes ? `take/* steps: ${Object.entries(m.takes).map(([k, n]) => `${n} ${k}`).join(", ")}. ` : "") +
    (m.appends ? `Shared logs (board_set append): ${Object.entries(m.appends).map(([k, a]) => `${k} ${a.lines} line${a.lines === 1 ? "" : "s"} from ${a.seats} seat${a.seats === 1 ? "" : "s"}${a.continuations ? `, ${a.continuations} continuation${a.continuations === 1 ? "" : "s"}` : ""}`).join("; ")}. ` : "") +
    (m.citedFrom === "none" ? "No proposal yet, so no citation credit.\n\n" : `Credit read from the ${m.citedFrom}${m.uncited.length ? `; findings never cited: ${m.uncited.join(", ")}` : ""}.\n\n`) +
    "Work is distinct targets (files, patterns, commands, web hosts), not tool calls. Polling is time in wait_for_messages over time in the room; idle is the part that returned nothing new. Model calls and tokens are the seat's own report; tokens in include cache reads and writes.\n\n" +
    "| seat | role | read | search | web | run | edit | hub calls | polling (idle) | model calls | tokens in/out | cost | recruits | proposals | challenges | verifies | votes | findings | cited |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n";
  for (const s of m.seats) {
    const calls = Object.values(s.calls).reduce((a, b) => a + b, 0);
    text += `| ${s.name} | ${s.role} | ${CLASSES.map((c) => s.work?.[c] ?? "?").join(" | ")} | ${calls} | ${pct(s.pollingShare)} (${pct(s.idlePollingShare)}) | ${s.usage?.requests ?? "?"} | ${s.usage ? `${tokens(s.usage)}/${s.usage.output_tokens ?? "?"}` : "?"} | ${s.usage?.cost_usd === undefined ? "?" : `$${s.usage.cost_usd.toFixed(2)}`} | ${s.recruits} | ${s.proposals} | ${s.challenges} | ${s.verifies} | ${s.votes} | ${s.findings} | ${s.cited.join(", ") || "-"} |\n`;
  }
  return `${text}\n`;
}

/** shaAuthor backed by git: the commit's author name in the first of `dirs` that has it, or undefined when none does. */
export function gitShaAuthor(...dirs: (string | undefined)[]): MetricsOptions["shaAuthor"] {
  const repos = [...new Set(dirs.filter((d): d is string => !!d))];
  if (!repos.length) return undefined;
  const memo = new Map<string, string | undefined>();
  return (sha) => {
    if (!memo.has(sha)) {
      let author: string | undefined;
      for (const cwd of repos) {
        const r = spawnSync("git", ["-C", cwd, "log", "-1", "--format=%an", `${sha}^{commit}`, "--"], { encoding: "utf8" });
        if (r.status === 0 && r.stdout.trim()) { author = r.stdout.trim(); break; }
      }
      memo.set(sha, author);
    }
    return memo.get(sha);
  };
}

/** The checkouts a room's seats worked in, from the workspaces the hub recorded on claim/* entries: a launcher run with
 * --cwd commits in another repository than the hub's own, so commits are looked up there first. */
export function roomRepos(events: readonly Ev[]): string[] {
  const dirs = events.flatMap((e) => (e.type === "board" && typeof e.entry?.workspace?.worktree === "string" ? [e.entry.workspace.worktree as string] : []));
  return [...new Set(dirs)];
}
