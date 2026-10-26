/**
 * The settings a run's Claude seats run with, carried by its room so the hub's recruits run with them too (decision/recruit-settings,
 * swarm-005940-77tu-room; server-chair note 7). A launched seat's environment is the launcher's (src/swarm.ts runProc) and a recruit's
 * was the hub's (src/spawner.ts), so on a hub the run did not start, recruits ran at the hub's effort and compaction window: Mac hub
 * 7717 gave recruits effort high while the launcher's seats ran xhigh, and unset, Claude Code runs Opus 5.5 at medium. The launcher
 * sends these with POST /rooms/<room>/create (env.ts launcherSeatSettings); break-outs inherit them through `parent`, and a run's
 * other rooms through its swarm-<id> prefix (hub/internal.ts seatSettingsOf); a room with none keeps the hub's environment.
 * --claude-full and --sandbox never reached a hub the launcher started, either: swarm.ts did not pass them on.
 *
 * Closed sets only: a room's settings never carry free environment. The model is not here: the hub's recruit policy is the operator's
 * machine-wide pin and beats requests (env.ts policyFromEnv); `models` is recorded beside each recruit's, never applied.
 * Type imports only: the vm harnesses (seat-env, claude-lean-flags) load this file for real and link specifiers as written.
 */
import type { Hub } from "../hub.js";
import type { SpawnerHooks } from "../spawner.js";

/** CLAUDE_CODE_EFFORT_LEVEL's values (Claude Code model-config); "default": the seats had none, so Claude Code's own default applies. */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max", "auto", "default"] as const;
export type Effort = (typeof EFFORTS)[number];

export interface SeatSettings {
  effort?: Effort;
  /** the CLAUDE_CODE_AUTO_COMPACT_WINDOW the seats got; "off": none, Claude Code's own default */
  compact_window?: number | "off";
  /** AI reviewer gates on seat commits (--seat-ai-gates on) */
  ai_gates?: "on" | "off";
  /** commit hooks in seat worktrees (--seat-hooks off) */
  seat_hooks?: "on" | "off";
  /** --claude-full: Claude Code's full flag set, not the lean one */
  claude_full?: boolean;
  /** --sandbox; a run can switch a recruit's sandbox on, never off (a hub started sandboxed stays so) */
  sandbox?: boolean;
  /** false: --no-web, no WebSearch/WebFetch */
  web?: boolean;
  /** false: --no-carry, no settled axes in the brief */
  carry?: boolean;
  /** the run's seat models: recorded beside each recruit's, never applied */
  models?: string[];
}

const KEYS = new Set(["effort", "compact_window", "ai_gates", "seat_hooks", "claude_full", "sandbox", "web", "carry", "models"]);
const onOff = (v: unknown, key: string) => { if (v !== "on" && v !== "off") throw new SeatSettingsError(`seat_settings.${key} must be "on" or "off"`); return v; };
const bool = (v: unknown, key: string) => { if (typeof v !== "boolean") throw new SeatSettingsError(`seat_settings.${key} must be true or false`); return v; };

/** A room's seat_settings outside the closed sets: the create route answers 400 with its message. */
export class SeatSettingsError extends Error {}

/** Validate a room's seat_settings from the create route. Throws on anything outside the closed sets, so nothing free reaches a seat. */
export function parseSeatSettings(raw: unknown): SeatSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SeatSettingsError("seat_settings must be an object");
  const r = raw as Record<string, unknown>;
  const unknown = Object.keys(r).filter((k) => !KEYS.has(k));
  if (unknown.length) throw new SeatSettingsError(`seat_settings: unknown key(s) ${unknown.join(", ")}`);
  const s: SeatSettings = {};
  if (r.effort !== undefined) {
    if (!EFFORTS.includes(r.effort as Effort)) throw new SeatSettingsError(`seat_settings.effort must be one of ${EFFORTS.join(", ")}`);
    s.effort = r.effort as Effort;
  }
  if (r.compact_window !== undefined) {
    const w = r.compact_window;
    if (w !== "off" && !(Number.isInteger(w) && (w as number) >= 100_000 && (w as number) <= 1_000_000)) throw new SeatSettingsError('seat_settings.compact_window must be a whole number of tokens from 100000 to 1000000, or "off"');
    s.compact_window = w as number | "off";
  }
  if (r.ai_gates !== undefined) s.ai_gates = onOff(r.ai_gates, "ai_gates");
  if (r.seat_hooks !== undefined) s.seat_hooks = onOff(r.seat_hooks, "seat_hooks");
  for (const k of ["claude_full", "sandbox", "web", "carry"] as const) if (r[k] !== undefined) s[k] = bool(r[k], k);
  if (r.models !== undefined) {
    if (!Array.isArray(r.models) || r.models.length > 20 || !r.models.every((m) => typeof m === "string" && m.length <= 80)) throw new SeatSettingsError("seat_settings.models must be a list of model names");
    s.models = [...new Set(r.models as string[])];
  }
  return s;
}

/** The create route's room option: {} when the body has no seat_settings. Throws SeatSettingsError on a bad one. */
export function seatSettingsOpt(raw: unknown): { seatSettings?: SeatSettings } {
  return raw === undefined ? {} : { seatSettings: parseSeatSettings(raw) };
}

/** The hub's environment with a room's run settings laid over it: the input to seatChildEnv for that room's recruits, so every
 * existing reader (seatCompactWindow, the AI gates, CHATROOM_CLAUDE_FULL, CHATROOM_SANDBOX, CHATROOM_SEAT_HOOKS) sees the run's values. */
export function withSeatSettings(env: NodeJS.ProcessEnv, s: SeatSettings | undefined): NodeJS.ProcessEnv {
  if (!s) return env;
  const out: NodeJS.ProcessEnv = { ...env };
  if (s.effort === "default") delete out.CLAUDE_CODE_EFFORT_LEVEL;
  else if (s.effort) out.CLAUDE_CODE_EFFORT_LEVEL = s.effort;
  if (s.compact_window === "off") { out.CHATROOM_SEAT_COMPACT_WINDOW = "off"; delete out.CLAUDE_CODE_AUTO_COMPACT_WINDOW; }
  else if (s.compact_window !== undefined) out.CHATROOM_SEAT_COMPACT_WINDOW = String(s.compact_window);
  if (s.ai_gates === "on") out.CHATROOM_SEAT_AI_GATES = "on";
  else if (s.ai_gates === "off") delete out.CHATROOM_SEAT_AI_GATES;
  if (s.seat_hooks === "off") out.CHATROOM_SEAT_HOOKS = "off";
  else if (s.seat_hooks === "on") delete out.CHATROOM_SEAT_HOOKS;
  if (s.claude_full === true) out.CHATROOM_CLAUDE_FULL = "1";
  else if (s.claude_full === false) delete out.CHATROOM_CLAUDE_FULL;
  if (s.sandbox === true) out.CHATROOM_SANDBOX = "1";
  return out;
}

/** What one recruit is started from: its room's run settings (undefined: none), the hub's environment, the two laid together
 * (`env`, which seatChildEnv, the sandbox and the worktree's hooks read), and the two settings no environment carries. */
export interface RecruitRun { run?: SeatSettings; hubEnv: NodeJS.ProcessEnv; env: NodeJS.ProcessEnv; web: boolean; carry: boolean }
export function recruitRun(hubEnv: NodeJS.ProcessEnv, run: SeatSettings | undefined): RecruitRun {
  return { run, hubEnv, env: withSeatSettings(hubEnv, run), web: run?.web !== false, carry: run?.carry !== false };
}

export type SettingSource = "run" | "hub" | "default";

/** One recruit's effective settings, read back from the environment it was started with, and where each came from: the
 * run's seat_settings, the hub's own environment, or Claude Code's default. The recruit_spawn event and list_agents carry it. */
export function effectiveSeatSettings(childEnv: NodeJS.ProcessEnv, r: RecruitRun, claude: boolean) {
  const from = (inRun: boolean, inHub: boolean): SettingSource => (inRun ? "run" : inHub ? "hub" : "default");
  const { run, hubEnv } = r;
  return {
    effort: claude ? childEnv.CLAUDE_CODE_EFFORT_LEVEL ?? null : null,
    compact_window: claude && childEnv.CLAUDE_CODE_AUTO_COMPACT_WINDOW ? Number(childEnv.CLAUDE_CODE_AUTO_COMPACT_WINDOW) : null,
    ai_gates: (childEnv.GUARD_NO_REVIEW && childEnv.GUARD_NO_REVIEW !== "0" ? "off" : "on") as "on" | "off",
    // seatChildEnv drops CHATROOM_SEAT_HOOKS (it governs the hub's worktree setup, not the seat), so it is read before
    seat_hooks: (r.env.CHATROOM_SEAT_HOOKS === "off" ? "off" : "on") as "on" | "off",
    claude_full: childEnv.CHATROOM_CLAUDE_FULL === "1",
    sandbox: childEnv.CHATROOM_SANDBOX === "1",
    web: r.web,
    carry: r.carry,
    source: {
      effort: from(run?.effort !== undefined, !!hubEnv.CLAUDE_CODE_EFFORT_LEVEL),
      compact_window: from(run?.compact_window !== undefined, !!hubEnv.CHATROOM_SEAT_COMPACT_WINDOW || !!hubEnv.CLAUDE_CODE_AUTO_COMPACT_WINDOW),
      ai_gates: from(run?.ai_gates !== undefined, !!hubEnv.CHATROOM_SEAT_AI_GATES),
      seat_hooks: from(run?.seat_hooks !== undefined, !!hubEnv.CHATROOM_SEAT_HOOKS),
      claude_full: from(run?.claude_full !== undefined, !!hubEnv.CHATROOM_CLAUDE_FULL),
      sandbox: from(run?.sandbox === true, !!hubEnv.CHATROOM_SANDBOX),
      web: from(run?.web !== undefined, false),
      carry: from(run?.carry !== undefined, false),
    } as Record<string, SettingSource>,
  };
}

/** The recruit_spawn telemetry event's body (the hub adds room, the requester's role and the time). It is written when the
 * request is accepted, not when the seat starts (src/hub/internal.ts). */
export type RecruitSpawn = { name: string; requested_by: string; kind: "in-room" | "breakout" | "replacement"; parent_room?: string; area?: string; depth: number; can_edit: boolean; agent: string; model: string | null; run_models?: string[] } & ReturnType<typeof effectiveSeatSettings>;

/** The spawner's two hooks into the hub for this: a room's run settings, and one persisted recruit_spawn event per recruit. */
export function recruitSettingsHooks(hub: Hub): Pick<SpawnerHooks, "seatSettings" | "recordSpawn"> {
  return {
    seatSettings: (room) => hub.seatSettingsFor(room),
    recordSpawn: (room, ev) => {
      const r = hub.rooms.get(room) ?? hub.rooms.get(ev.parent_room ?? "");
      if (!r) return;
      const role = [...(hub.rooms.get(ev.parent_room ?? room) ?? r).participants.values()].find((p) => p.name === ev.requested_by)?.role;
      hub.persist({ type: "recruit_spawn", room: r.name, ...ev, ...(role ? { by_role: role } : {}), ts: new Date().toISOString() });
    },
  };
}
