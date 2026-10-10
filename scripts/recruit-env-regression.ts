/** A seat (launcher seat or hub-spawned recruit) must not inherit the parent hub's policy. Run: npx tsx scripts/recruit-env-regression.ts */
import assert from "node:assert/strict";
import { seatChildEnv } from "../src/env.js";

const parent: NodeJS.ProcessEnv = {
  PATH: "/usr/bin", HOME: "/h", ANTHROPIC_API_KEY: "k",
  // hub policy: must not reach a seat, or a private hub it starts runs under the parent's mechanisms
  CHATROOM_FRESH_CHALLENGER: "1", CHATROOM_FRESH_CHALLENGER_WAIT_MIN: "6", CHATROOM_NO_OUTPUT_MS: "1", CHATROOM_NO_OUTPUT_CLAIMED_MS: "1",
  CHATROOM_NUDGE_AFTER_MS: "1", CHATROOM_IDLE_LEAVE_WAITS: "1", CHATROOM_DRAFT_REVEAL_MS: "1", CHATROOM_STALE_CLAIM_MS: "1",
  CHATROOM_HUMAN_NAMES: "benji", CHATROOM_HUMAN_TOKEN: "t", CHATROOM_LAUNCHER_TOKEN: "t", CHATROOM_INSECURE_LOCAL: "1",
  CHATROOM_SPAWN_DRY: "1", CHATROOM_RECRUIT_MAX_MIN: "1", CHATROOM_FUTURE_MECHANISM: "1", PORT: "7742", CHATROOM_DATA_DIR: "/d",
  // kept: the seat's own wiring, and the guards that keep a private hub inside the room's model/cost rules
  CHATROOM_SEAT_KEY: "sk", CHATROOM_HEARTBEAT_URL: "http://x/hb", CHATROOM_MCP_URL: "http://x/mcp", CHATROOM_NO_RECRUIT: "1",
  CHATROOM_RECRUIT_AGENT: "claude", CHATROOM_RECRUIT_MODEL: "claude-opus-5-5", CHATROOM_MAX_LIVE_AGENTS: "9", CHATROOM_MAX_RECRUITS_PER_ROOM: "3",
  CHATROOM_CLAUDE_FULL: "1", CHATROOM_SANDBOX: "1",
};
const out = seatChildEnv(parent, "w1");
for (const k of ["CHATROOM_FRESH_CHALLENGER", "CHATROOM_FRESH_CHALLENGER_WAIT_MIN", "CHATROOM_NO_OUTPUT_MS", "CHATROOM_NO_OUTPUT_CLAIMED_MS", "CHATROOM_NUDGE_AFTER_MS", "CHATROOM_IDLE_LEAVE_WAITS", "CHATROOM_DRAFT_REVEAL_MS", "CHATROOM_STALE_CLAIM_MS", "CHATROOM_HUMAN_NAMES", "CHATROOM_HUMAN_TOKEN", "CHATROOM_LAUNCHER_TOKEN", "CHATROOM_INSECURE_LOCAL", "CHATROOM_SPAWN_DRY", "CHATROOM_RECRUIT_MAX_MIN", "CHATROOM_FUTURE_MECHANISM", "PORT", "CHATROOM_DATA_DIR"])
  assert.ok(!(k in out), `${k} leaked into the seat's environment`);
for (const k of ["CHATROOM_SEAT_KEY", "CHATROOM_HEARTBEAT_URL", "CHATROOM_MCP_URL", "CHATROOM_NO_RECRUIT", "CHATROOM_RECRUIT_AGENT", "CHATROOM_RECRUIT_MODEL", "CHATROOM_MAX_LIVE_AGENTS", "CHATROOM_MAX_RECRUITS_PER_ROOM", "CHATROOM_CLAUDE_FULL", "CHATROOM_SANDBOX", "PATH", "HOME", "ANTHROPIC_API_KEY"])
  assert.equal(out[k], parent[k], `${k} must reach the seat`);
assert.equal(out.GIT_AUTHOR_NAME, "w1");
assert.ok("CHATROOM_FRESH_CHALLENGER" in parent, "input untouched");
console.log("RECRUIT ENV OK");
