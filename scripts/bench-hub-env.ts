/** The bench room arm's hub environment (scripts/bench-rq1.ts arms C and D), and the recruits it ran.
 *
 * Before this the hub got no CHATROOM_* variable at all and CHATROOM_NO_RECRUIT=1, so a mechanism behind a hub
 * flag (the fresh challenger, idle-leave, the no-output warning) could not be switched on in a bench run and
 * compared within one build. `--hub-env KEY=VAL` passes one allowlisted mechanism flag; `--recruit-model M` lifts
 * the recruitment refusal with recruits pinned to claude and M. Secrets stay stripped either way, and
 * CHATROOM_STRIP_SECRETS=1 stops the hub refilling them from .env once NO_RECRUIT no longer does.
 */
import type { SeatUsageRollup } from "../src/result.js";

/** Flags that change how a room behaves. Never tokens, ports, data dirs or the recruit pin (that is --recruit-model). */
export const HUB_FLAG_ALLOWLIST: ReadonlySet<string> = new Set([
  "CHATROOM_FRESH_CHALLENGER",
  "CHATROOM_FRESH_CHALLENGER_WAIT_MIN",
  "CHATROOM_IDLE_LEAVE_WAITS",
  "CHATROOM_NO_OUTPUT_MS",
  "CHATROOM_NO_OUTPUT_CLAIMED_MS",
  "CHATROOM_NUDGE_AFTER_MS",
  "CHATROOM_DRAFT_REVEAL_MS",
  "CHATROOM_STALE_CLAIM_MS",
]);
export const RECRUIT_MODELS: ReadonlySet<string> = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

const SECRET = /API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i;

/** `KEY=VAL` pairs from repeated --hub-env flags; throws on anything outside the allowlist. */
export function parseHubEnv(pairs: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const i = pair.indexOf("=");
    const key = i > 0 ? pair.slice(0, i) : pair;
    if (i <= 0 || !HUB_FLAG_ALLOWLIST.has(key)) throw new Error(`--hub-env ${pair}: expected KEY=VAL with KEY one of ${[...HUB_FLAG_ALLOWLIST].join(", ")}`);
    out[key] = pair.slice(i + 1);
  }
  return out;
}

export interface BenchHubWhere {
  port: number;
  dataDir: string;
  workspace: string;
  logDir: string;
  hubEnv?: Record<string, string>;
  recruitModel?: string;
}

export function benchHubEnv(base: NodeJS.ProcessEnv, o: BenchHubWhere): NodeJS.ProcessEnv {
  if (o.recruitModel !== undefined && !RECRUIT_MODELS.has(o.recruitModel)) throw new Error(`--recruit-model ${o.recruitModel}: expected one of ${[...RECRUIT_MODELS].join(", ")}`);
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) if (!k.startsWith("CHATROOM_") && !SECRET.test(k)) env[k] = v;
  Object.assign(env, parseHubEnv(Object.entries(o.hubEnv ?? {}).map(([k, v]) => `${k}=${v}`)));
  Object.assign(env, { PORT: String(o.port), HOST: "127.0.0.1", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: o.dataDir, CHATROOM_DEFAULT_CWD: o.workspace, CHATROOM_LOG_DIR: o.logDir });
  if (o.recruitModel) Object.assign(env, { CHATROOM_RECRUIT_AGENT: "claude", CHATROOM_RECRUIT_MODEL: o.recruitModel, CHATROOM_STRIP_SECRETS: "1" });
  else env.CHATROOM_NO_RECRUIT = "1";
  return env;
}

export interface RecruitRecord {
  name: string;
  agent: string | null;
  model: string | null;
  started_at: string | null;
  ended_at: string | null;
  exit_code: number | null;
  /** null while running, after a kill, or when the CLI output did not parse: unknown, never zero */
  usage: SeatUsageRollup | null;
}

/** The hub's GET /agents rows as run records; anything that is not a row is ignored. */
export function recruitRecords(agents: unknown): RecruitRecord[] {
  if (!Array.isArray(agents)) return [];
  return agents.filter((a): a is Record<string, unknown> => !!a && typeof a === "object" && typeof (a as { name?: unknown }).name === "string").map((a) => {
    const usage = a.usage && typeof a.usage === "object" && typeof (a.usage as { cost?: unknown }).cost === "number" ? (a.usage as SeatUsageRollup) : null;
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    return { name: String(a.name), agent: str(a.agent), model: str(a.model), started_at: str(a.startedAt), ended_at: str(a.endedAt), exit_code: typeof a.exitCode === "number" ? a.exitCode : null, usage };
  });
}
