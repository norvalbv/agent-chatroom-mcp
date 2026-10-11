/**
 * Whether the launcher should replace a seat that exited while its room is still open.
 *
 * The first respawning launcher replaced every exiting seat, so a seat that had finished its slice, handed over and
 * left (as the brief allows once leaving_would_block is false) was replaced by one that read the board, found nothing
 * to inherit, and left too: 70 respawns across two 20-seat runs in 30 minutes, each costing a board read under a
 * 100 req/min account cap (docs/board-electorate-swarm-200859.md, evidence/launcher-respawn-churn). The ranked remaining
 * item asked for an explicit completed / error / orphaned-work distinction, a floor the room must keep, the verifier
 * preserved, and bounded retries. This module is that decision; the launcher supplies the room summary it already polls.
 */
import { spawn } from "node:child_process";

export interface RespawnRoom {
  state: string;
  quorum?: string | null;
  expected_participants?: number | null;
  participants: { name: string; agent: string; role?: string | null; active: boolean }[];
  board: Record<string, { by: string }>;
  /** From the room summary; the quorum floor binds only while one is open. */
  proposals?: { status: string }[];
}

export interface RespawnInput {
  name: string;
  /** Child exit code; null when killed by a signal. Anything but 0 is a failure, not completion. */
  exitCode: number | null;
  /** The signal that killed it, when one did (node reports code null for every signal, so the code alone cannot tell an
   * operator's SIGTERM from the SIGKILL macOS sends when memory runs out). */
  signal?: string | null;
  /** 1 for the first replacement. */
  attempt: number;
  room: RespawnRoom | null;
  maxAttempts?: number;
}

export interface RespawnDecision { respawn: boolean; reason: string }

/**
 * Why a Claude seat's process ended, read from its own last output, for the launcher's exit receipt. A seat stopped by
 * the account's usage limit prints one line ("You've hit your session limit · resets 2:10am (Europe/London)") and exits
 * 1; the room was told only "seat process exited (exit 1, launcher receipt)", so three such exits in one minute read
 * as three crashes until a seat opened another seat's output file (swarm-003601-tky5 #139-#146). Same for a seat whose
 * compaction window (--compact-at) is too small for what it reads. The hub keeps the first 80 characters of a receipt.
 */
const LIMIT = /You(?:'|’)ve hit your (?:session|weekly|usage|[a-z0-9 -]{1,30}) limit(?:\s*·\s*resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([A-Za-z_]+\/[A-Za-z_/+-]+)\))?/i;
const THRASH = /Autocompact is thrashing/;

/** The CLI prints its notice as the seat's final line; an earlier line that quotes one (a seat that read another seat's log) is not it. */
const lastLine = (output: string) => output.trimEnd().split("\n").pop() ?? "";

/** The usage-limit notice in a seat's output, with the instant it resets when the notice names a time and zone we can read. */
export function usageLimit(output: string, now = Date.now()): { resetsAt?: string } | null {
  const m = LIMIT.exec(lastLine(output));
  if (!m) return null;
  if (!m[1] || !m[4]) return {};
  let local: Intl.DateTimeFormatPart[];
  try { local = new Intl.DateTimeFormat("en-GB", { timeZone: m[4], hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now); } catch { return {}; }
  const part = (type: string) => Number(local.find((p) => p.type === type)?.value ?? 0);
  const target = (Number(m[1]) % 12 + (m[3].toLowerCase() === "pm" ? 12 : 0)) * 60 + Number(m[2] ?? 0);
  // minutes from the zone's clock now to the next time it reads the target (a daylight-saving change in between is ignored)
  const ahead = (target - (part("hour") * 60 + part("minute")) + 1440) % 1440 || 1440;
  return { resetsAt: new Date(Math.floor(now / 60_000) * 60_000 + ahead * 60_000).toISOString() };
}

/** The detail of a seat's exit receipt: its exit code and, for a failed exit, the reason its output names. */
export function exitDetail(code: number | null, output: string | string[], now = Date.now(), signal?: string | null): string {
  if (code === null && signal) return signal === "SIGKILL" ? "killed by SIGKILL: out of memory or another process" : `stopped by ${signal}`;
  const base = `exit ${code}`;
  if (code === 0 || code === null) return base;
  // stdout and stderr are separate streams: the notice is the last line of one of them
  for (const out of typeof output === "string" ? [output] : output) {
    const limit = usageLimit(out, now);
    if (limit) return `${base}: usage limit${limit.resetsAt ? `, resets ${limit.resetsAt.slice(11, 16)} UTC` : ""}`;
    if (THRASH.test(lastLine(out))) return `${base}: compaction thrashing, the compact window is too small`;
  }
  return base;
}

/** Why a seat's process ended, as a closed set a run can be counted by (telemetry gap G4: "seat process exited (exit 1)"
 * said nothing countable, and a usage limit was only in the seat's .out). unknown: a receipt this build cannot read. */
export type SeatExitCause = "normal" | "usage_limit" | "thrash" | "sigterm" | "sigkill" | "signal" | "crash" | "unknown";
export interface SeatExit { exit_code: number | null; signal?: string; cause: SeatExitCause; resets_utc?: string }

/** exitDetail's words back as fields: the launcher and the spawner already send that string as the exit receipt. */
export function exitCause(detail: string): SeatExit {
  const by = /^(?:killed|stopped) by (SIG[A-Z0-9]+)/.exec(detail);
  if (by) return { exit_code: null, signal: by[1], cause: by[1] === "SIGKILL" ? "sigkill" : by[1] === "SIGTERM" ? "sigterm" : "signal" };
  const m = /^exit (-?\d+)(?::\s*(.*))?$/.exec(detail.trim());
  if (!m) return { exit_code: null, cause: "unknown" };
  const exit_code = Number(m[1]), why = m[2] ?? "";
  const resets = /resets (\d{2}:\d{2}) UTC/.exec(why)?.[1];
  if (/usage limit/.test(why)) return { exit_code, cause: "usage_limit", ...(resets ? { resets_utc: resets } : {}) };
  if (/thrash/.test(why)) return { exit_code, cause: "thrash" };
  // 128 + n: a shell or a wrapper reporting the signal that ended it as an exit code
  if (exit_code === 143) return { exit_code, signal: "SIGTERM", cause: "sigterm" };
  if (exit_code === 137) return { exit_code, signal: "SIGKILL", cause: "sigkill" };
  return { exit_code, cause: exit_code === 0 ? "normal" : "crash" };
}
/** Who stopped a seat, when its launcher knows (G5: 11 exit-143s with no sender): the run's timeout, or the operator stopping the launcher. */
export const STOPPED_BY = ["timeout", "operator"] as const;
export type StoppedBy = (typeof STOPPED_BY)[number];
/** Why a run ended, as its launcher saw it (G2; evidence pack item 13: a run stopped with SIGTERM left no reason). */
export const RUN_END_CAUSES = ["concluded", "timeout", "operator_stop", "seats_exited"] as const;
export type RunEndCause = (typeof RUN_END_CAUSES)[number];

/** The smallest room that can still conclude under scrutiny: a proposer, a challenger and a verifier. */
export const MIN_FLOOR = 3;

/**
 * The floor the room must keep. Between proposals a lobby may thin to its analysis and build seats without being
 * refilled: replacements that arrive then read the board, find no claim and leave (lobby swarm-214936 was held at its
 * quorum floor of 16 this way). Once a proposal is open the electorate matters, and the quorum floor binds.
 */
export function floorFor(room: RespawnRoom): number {
  const open = (room.proposals ?? []).some((p) => p.status === "open");
  if (!open) return MIN_FLOOR;
  const expected = room.expected_participants ?? 0;
  if (room.quorum === "unanimous") return Math.max(MIN_FLOOR, expected);
  if (room.quorum === "supermajority") return Math.max(MIN_FLOOR, Math.ceil(expected * 0.75));
  return Math.max(MIN_FLOOR, Math.ceil(expected / 2));
}

export function respawnDecision(i: RespawnInput): RespawnDecision {
  const max = i.maxAttempts ?? 3;
  if (!i.room) return { respawn: false, reason: "room missing" };
  if (i.room.state !== "open" && i.room.state !== "stalled") return { respawn: false, reason: `room is ${i.room.state}` };
  if (i.attempt > max) return { respawn: false, reason: `retry cap (${max}) reached` };
  const me = i.room.participants.find((p) => p.name === i.name);
  if (i.name === "verifier" || me?.role === "verifier") return { respawn: true, reason: "the verifier seat is required" };
  // 143 is SIGTERM: an operator (or the launcher itself) stopped the seat on purpose; bench-3 was killed by hand and
  // relaunched three times before this line existed.
  // SIGKILL (code null, or 137 from a wrapper) is not that: macOS kills with it when memory runs out, and so does a stray
  // `kill -9` from another seat. A grouped run lost a seat to one and did not replace it (swarm-003601-tky5 #296).
  if (i.signal === "SIGKILL" || i.exitCode === 137) return { respawn: true, reason: `killed by SIGKILL${i.exitCode === 137 ? " (exit 137)" : ""}: out of memory or another process, not a stop` };
  if (i.exitCode === 143 || i.exitCode === null) return { respawn: false, reason: "stopped by signal, not a crash" };
  if (i.exitCode !== 0) return { respawn: true, reason: `exit code ${i.exitCode} is a failure, not completion` };
  const claims = Object.entries(i.room.board).filter(([k, v]) => k.startsWith("claim/") && v.by === i.name).map(([k]) => k);
  const handoffs = new Set(Object.entries(i.room.board).filter(([k, v]) => k.startsWith("handoff/") && v.by === i.name).map(([k]) => k.slice("handoff/".length)));
  const orphaned = claims.filter((k) => !handoffs.has(k.slice("claim/".length)));
  if (orphaned.length && handoffs.size === 0) return { respawn: true, reason: `unfinished ${orphaned[0]} with no handoff/* by ${i.name}` };
  const active = i.room.participants.filter((p) => p.active && p.agent !== "human").length;
  const floor = floorFor(i.room);
  if (active < floor) return { respawn: true, reason: `${active} active seats is below the floor of ${floor}` };
  return { respawn: false, reason: `completed: ${active} active seats (floor ${floor}), ${claims.length ? "claims handed over" : "no claim left behind"}` };
}

/** The hub did not answer (connection refused, timed out, or a 5xx): nothing is known about the room, so nothing is decided. */
export class HubUnreachable extends Error {}

/** The room's summary, or null when the hub answers that it has no such room. Throws HubUnreachable when the hub does not answer. */
export async function fetchRespawnRoom(url: string, room: string, request: typeof fetch = fetch): Promise<RespawnRoom | null> {
  let response: Response;
  try {
    response = await request(`${url}/rooms/${encodeURIComponent(room)}`, { signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    throw new HubUnreachable(error instanceof Error ? error.message : String(error));
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new HubUnreachable(`the hub answered ${response.status}`);
  // the body is read inside a try too: a hub that dies after its headers throws here (TypeError "terminated", or a
  // SyntaxError on half a body), and that is a hub that did not answer, not a room that is missing
  try {
    return await response.json() as RespawnRoom;
  } catch (error) {
    throw new HubUnreachable(`the hub's answer was cut off: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Launcher-side registration: the launcher (which knows the process exited) calls the hub's
 * POST /rooms/:room/replacements before launching the successor, and passes the returned
 * one-use join proof to the successor in its brief. The launcher credential itself never
 * reaches the successor: it is excluded from seat environments (src/env.ts).
 */
export async function registerRespawn(
  url: string, room: string, previousName: string, name: string,
  token: string | undefined, request: typeof fetch = fetch, reason = "",
): Promise<string> {
  if (!token) throw new Error('Respawn requires CHATROOM_LAUNCHER_TOKEN; refusing to launch an unregistered replacement.');
  const response = await request(`${url}/rooms/${encodeURIComponent(room)}/replacements`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-chatroom-launcher-token': token },
    body: JSON.stringify({ replacement_of: previousName, name }),
  }).catch((error: unknown) => { throw new HubUnreachable(error instanceof Error ? error.message : String(error)); });
  if (!response.ok) throw new Error(`Replacement registration failed (${response.status}); refusing to launch an unregistered replacement.`);
  const result = await response.json() as { replacementToken?: unknown };
  if (typeof result.replacementToken !== "string" || !result.replacementToken) throw new Error("Replacement registration returned no join proof.");
  return `\n\nYou replace ${previousName}, who dropped out of this room${reason ? ` (${reason})` : ""}. The launcher has registered this replacement with the hub. On your first join_room call use name=${JSON.stringify(name)} and replacement_token=${JSON.stringify(result.replacementToken)}. This one-use join proof is only for this reserved seat: do not post it to chat or board. Before anything else read the board (board_get) and the recent messages (read_messages since_seq=0 is too much: read the last 40), take over any unfinished claim/* entry of theirs, and say in one line that you have.`;
}

/**
 * Whether the hub at `url` would accept a replacement from this launcher, asked at launch: the line to print when it
 * would not, or null. Holding a token proves nothing (a token file can be an earlier hub's, and a hub started with no
 * CHATROOM_LAUNCHER_TOKEN refuses them all), so the launcher asks with a room name that cannot exist: 503 is a hub
 * with no token, 401 one that has another, anything else got past the credential check. Nothing is created.
 */
export async function respawnProbe(url: string, token: string | undefined, request: typeof fetch = fetch): Promise<string | null> {
  const response = await request(`${url}/rooms/${encodeURIComponent("respawn probe")}/replacements`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-chatroom-launcher-token': token } : {}) },
    body: JSON.stringify({ replacement_of: "probe", name: "probe" }),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => undefined);
  if (!response) return null;
  const lead = `WARNING: --respawn WILL NOT WORK on ${url}: `;
  const tail = " A seat that dies in this run will not be replaced by the launcher; seats can still recruit a replacement themselves (request_agent replacing=<name>).";
  if (response.status === 503) return `${lead}that hub was started with no launcher token, so it refuses every replacement seat. Stop it and restart it with \`npm run hubd\` (it sets a token and shares it), or with CHATROOM_LAUNCHER_TOKEN set in the hub's and this launcher's environment.${tail}`;
  if (response.status === 401) return `${lead}${token ? "that hub does not accept this launcher's token (it was started with another one; a token file left by an earlier hub is not this hub's)" : "this launcher has no CHATROOM_LAUNCHER_TOKEN and found no token file for that hub"}. Give this launcher the token the hub was started with.${tail}`;
  return null;
}

/** The `claude` arguments of the usage probe: one tiny call, on `model` when the seat had one, else on the CLI's default as the seat ran. */
export function usageProbeArgs(model?: string): string[] {
  return ["-p", "Reply with the single word OK.", ...(model ? ["--model", model] : [])];
}

/**
 * Whether the account can run a Claude seat on `model` again: one tiny `claude -p` call (a refused one costs nothing).
 * The limits are per model, so the model asked is the stopped seat's own: the launcher used to ask on its first worker
 * model for every seat, and an answer from that one says nothing about a verifier or a worker on another.
 */
export function claudeUsageProbe(o: { model?: string; cwd: string; env: NodeJS.ProcessEnv; log?: (line: string) => void; who?: string; timeoutMs?: number }): Promise<boolean> {
  return new Promise((done) => {
    const said = (ready: boolean, why = "") => {
      o.log?.(`usage probe${o.who ? ` for ${o.who}` : ""} on ${o.model ?? "the CLI's default model"}: ${ready ? "usage is back" : `still out of usage${why ? ` (${why})` : ""}`}`);
      done(ready);
    };
    const child = spawn("claude", usageProbeArgs(o.model), { cwd: o.cwd, env: o.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGTERM"), o.timeoutMs ?? 120_000);
    child.on("close", (code) => { clearTimeout(timer); said(code === 0 && !usageLimit(out), usageLimit(out) ? "the limit notice" : `exit ${code}`); });
    child.on("error", (e) => { clearTimeout(timer); said(false, e.message); });
  });
}

export interface RespawnChainDeps<T> {
  name: string;
  maxAttempts?: number;
  /** True once the launcher is stopping or too close to its timeout for a successor to be worth launching. */
  stop: () => boolean;
  room: () => Promise<RespawnRoom | null>;
  exitCode: (name: string) => number | null;
  /** The signal that ended it, if one did. */
  signal?: (name: string) => string | null;
  /** Registers the successor with the hub and returns the note for its brief; a throw ends the chain. */
  register: (previousName: string, name: string, reason: string) => Promise<string>;
  run: (name: string, note: string) => Promise<T>;
  log?: (line: string) => void;
  /** The exit receipt's detail for a seat (exitDetail): a usage-limit exit is respawned only once usageReady says so. */
  detail?: (name: string) => string;
  /** Whether the account can run a seat again (a tiny model call that is not refused); asked every usagePollMs. */
  usageReady?: () => Promise<boolean>;
  usagePollMs?: number;
  /** How long a hub that does not answer is waited for before the chain gives up (default 10 minutes), and how often it is asked. */
  unreachableWaitMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}
/**
 * Run a seat and, while respawnDecision says so, its successors `name-r1..rN`. Every replaced attempt is handed
 * back under its own process name: the launcher used to keep only the last outcome, so a crashed attempt's
 * usage dropped out of the run total while coverage still read "complete".
 *
 * A hub that does not answer (`room` or `register` throws HubUnreachable) is waited for, not taken as an answer: the
 * launcher of swarm-094251-5y46 asked 45 s into an 8-minute outage and logged "room missing" for a room that came back.
 */
export async function respawnChain<T>(d: RespawnChainDeps<T>): Promise<{ last: T; lastName: string; replaced: { name: string; outcome: T }[] }> {
  const max = d.maxAttempts ?? 3;
  const replaced: { name: string; outcome: T }[] = [];
  const waitMs = d.unreachableWaitMs ?? 600_000;
  const pollMs = d.pollMs ?? 5_000;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  /** `ask` again every pollMs while the hub is unreachable; rethrows HubUnreachable once waitMs has passed or the launcher is stopping. */
  const reach = async <R>(who: string, ask: () => Promise<R>): Promise<R> => {
    for (let waited = 0; ; waited += pollMs) {
      try {
        const answer = await ask();
        if (waited) d.log?.(`the hub answers again after about ${Math.round(waited / 1000)} s`);
        return answer;
      } catch (error) {
        if (!(error instanceof HubUnreachable)) throw error;
        if (waited >= waitMs || d.stop()) throw error;
        if (!waited) d.log?.(`${who} exited and the hub is unreachable (${error.message}); asking again every ${Math.round(pollMs / 1000)} s for up to ${Math.round(waitMs / 60_000)} min before deciding`);
        await sleep(pollMs);
      }
    }
  };
  const gaveUp = (who: string) => d.log?.(`${who} exited; not respawning: ${d.stop() ? "the launcher is stopping" : `the hub was unreachable for ${Math.round(waitMs / 60_000)} min`}`);
  let last = await d.run(d.name, "");
  let lastName = d.name;
  // the last attempt that actually took its seat: a successor that died before joining is replaced in this one's name.
  // Unknown until the room shows it; the first attempt is assumed seated unless it was stopped by the usage limit.
  let seatedName: string | undefined;
  const usagePollMs = d.usagePollMs ?? 300_000;
  for (let i = 1; i <= max; i++) {
    if (d.stop()) break;
    // stopped by the account's usage limit: a successor started now dies of the same limit within seconds (swarm-003601-tky5
    // lost its verifier that way), so wait until the account runs a seat again, or the launcher stops
    const outOfUsage = !!d.usageReady && /usage limit/.test(d.detail?.(lastName) ?? "");
    if (outOfUsage) {
      d.log?.(`${lastName} was stopped by the account's usage limit (${d.detail?.(lastName)}); waiting for usage before respawning, checking every ${Math.round(usagePollMs / 60_000) || 1} min`);
      let ready = false;
      for (let waited = 0; !d.stop(); waited += usagePollMs) {
        if ((ready = await d.usageReady!().catch(() => false))) { d.log?.(`usage is back after about ${Math.round(waited / 60_000)} min`); break; }
        await sleep(usagePollMs);
      }
      if (!ready) { d.log?.(`${lastName} exited; not respawning: the launcher is stopping while the account is out of usage`); break; }
    }
    let room: RespawnRoom | null = null;
    try {
      room = await reach(lastName, d.room);
    } catch (error) {
      if (error instanceof HubUnreachable) { gaveUp(lastName); break; }
      // an error this chain does not know says nothing about the room: name it, never fall through to "room missing"
      d.log?.(`${lastName} exited; not respawning: the room could not be read (${error instanceof Error ? `${error.name}: ${error.message}` : String(error)})`);
      break;
    }
    if (room?.participants?.some((p) => p.name === lastName)) seatedName = lastName;
    // a seat the limit stopped before it ever joined (often before the room existed) has no seat to hand over: start it again
    const decision = outOfUsage && !seatedName
      ? { respawn: true, reason: "stopped by the account's usage limit before it joined" }
      : respawnDecision({ name: lastName, exitCode: d.exitCode(lastName), signal: d.signal?.(lastName), attempt: i, room, maxAttempts: max });
    if (!decision.respawn) {
      d.log?.(`${lastName} exited; not respawning: ${decision.reason}`);
      break;
    }
    const name = `${d.name}-r${i}`;
    // whom the successor replaces: the last attempt seen in the room; if none was seen, the one that just exited, except
    // after a usage-limit exit, where an attempt not seen in the room never joined and there is nothing to hand over
    const predecessor = seatedName ?? (outOfUsage ? undefined : lastName);
    let note = "";
    if (predecessor) {
      try {
        note = await reach(lastName, () => d.register(predecessor, name, decision.reason));
      } catch (error) {
        if (error instanceof HubUnreachable) { gaveUp(lastName); break; }
        d.log?.(`Not respawning ${lastName}: ${error instanceof Error ? error.message : "replacement registration failed"}`);
        break;
      }
    }
    d.log?.(`${lastName} exited while the room is ${room?.state ?? "not yet created"}; respawning as ${name}: ${decision.reason}`);
    replaced.push({ name: lastName, outcome: last });
    last = await d.run(name, note);
    lastName = name;
  }
  return { last, lastName, replaced };
}
