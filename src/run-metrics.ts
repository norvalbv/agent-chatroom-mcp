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

const CLASSES: WorkClass[] = ["read", "search", "web", "run", "edit"];
const SHA = /\b[0-9a-f]{7,40}\b/g;
const NOT_CREDIT = /^(claim|draft|inbox|hold)\//;
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
  /** rate: workers who recruited at least once over workers */
  recruits: { calls: number; seats: number; workers: number; rate: number };
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
        break;
      }
      case "proposal": {
        const p = e.proposal ?? {};
        firstAt.proposal ??= p.createdAt;
        stamp(p.createdAt);
        proposal = p.text;
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
    for (const [key, by] of boardBy) if (!NOT_CREDIT.test(key) && cited.includes(key)) named(by)?.cited.push(key);
    for (const sha of new Set(cited.match(SHA) ?? [])) {
      if (!/[a-f]/.test(sha)) continue;
      const author = opts.shaAuthor?.(sha) ?? shaFirst.get(sha);
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

const pct = (x: number | undefined) => (x === undefined ? "?" : `${Math.round(x * 100)}%`);
const at = (m: number | undefined, what: string) => (m === undefined ? `no ${what}` : `${what} ${m} min`);

/** The metrics as a report section: one headline line, then one row per seat. */
export function renderMetrics(m: RunMetrics): string {
  const t = m.minutesTo;
  let text = `## Metrics\n\nComputed from the hub's room log (${m.room}). ${[at(t.firstClaim, "first claim"), at(t.firstSource, "first source"), at(t.firstProposal, "first proposal"), at(t.conclusion, "conclusion")].join(", ")}. ` +
    `${m.recruits.seats} of ${m.recruits.workers} workers recruited (${pct(m.recruits.rate)}, ${m.recruits.calls} recruit${m.recruits.calls === 1 ? "" : "s"}); ` +
    (m.webSeats === undefined ? "no work ledger in this log, so reads, searches and web calls are unknown. " : `${m.webSeats} of ${m.seats.length} seats made a web call. `) +
    `Credit read from the ${m.citedFrom}${m.uncited.length ? `; findings never cited: ${m.uncited.join(", ")}` : ""}.\n\n` +
    "Work is distinct targets (files, patterns, commands, web hosts), not tool calls. Polling is time in wait_for_messages over time in the room; idle is the part that returned nothing new.\n\n" +
    "| seat | role | read | search | web | run | edit | hub calls | polling (idle) | recruits | proposals | challenges | verifies | votes | findings | cited |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n";
  for (const s of m.seats) {
    const calls = Object.values(s.calls).reduce((a, b) => a + b, 0);
    text += `| ${s.name} | ${s.role} | ${CLASSES.map((c) => s.work?.[c] ?? "?").join(" | ")} | ${calls} | ${pct(s.pollingShare)} (${pct(s.idlePollingShare)}) | ${s.recruits} | ${s.proposals} | ${s.challenges} | ${s.verifies} | ${s.votes} | ${s.findings} | ${s.cited.join(", ") || "-"} |\n`;
  }
  return `${text}\n`;
}

/** shaAuthor backed by git in `cwd`: the commit's author name, or undefined when the repo does not have it. */
export function gitShaAuthor(cwd: string | undefined): MetricsOptions["shaAuthor"] {
  if (!cwd) return undefined;
  const memo = new Map<string, string | undefined>();
  return (sha) => {
    if (!memo.has(sha)) {
      const r = spawnSync("git", ["-C", cwd, "log", "-1", "--format=%an", sha, "--"], { encoding: "utf8" });
      memo.set(sha, r.status === 0 ? r.stdout.trim() || undefined : undefined);
    }
    return memo.get(sha);
  };
}
