/** Launcher respawn is conditional (runs swarm-200839 / swarm-200859, item "respawn churn"): a seat that finished and
 * handed over is not replaced merely because its room is still open. npx tsx scripts/respawn-regression.ts */
import assert from "node:assert/strict";
import { respawnDecision, type RespawnRoom } from "../src/respawn.js";

const seat = (name: string, active = true, role = "worker", agent = "openrouter") => ({ name, agent, role, active });
const room = (over: Partial<RespawnRoom> = {}): RespawnRoom => ({
  state: "open", quorum: "majority", expected_participants: 20,
  participants: [...Array.from({ length: 15 }, (_, i) => seat(`u-${i}`)), seat("verifier", true, "verifier"), seat("gone", false)],
  board: {},
  proposals: [{ status: "open" }],
  ...over,
});
const decide = (over: Partial<Parameters<typeof respawnDecision>[0]> = {}) =>
  respawnDecision({ name: "gone", exitCode: 0, attempt: 1, room: room(), ...over });

// 1. Completed seat, room comfortably above its floor, nothing left behind: not replaced (the churn case).
let d = decide();
assert.equal(d.respawn, false, d.reason); assert.match(d.reason, /completed/);
// 2. A crash or provider death is not completion.
d = decide({ exitCode: 1 }); assert.equal(d.respawn, true, d.reason); assert.match(d.reason, /exit/);
// 3. An unfinished claim/* without a handoff/* by the same seat is orphaned work.
d = decide({ room: room({ board: { "claim/board-scaling": { by: "gone" } } }) });
assert.equal(d.respawn, true, d.reason); assert.match(d.reason, /claim\/board-scaling/);
// 4. ...but a claim with a handoff by the same seat is finished work.
d = decide({ room: room({ board: { "claim/board-scaling": { by: "gone" }, "handoff/board-scaling": { by: "gone" } } }) });
assert.equal(d.respawn, false, d.reason);
// 5. Another seat's claim is not this seat's debt.
d = decide({ room: room({ board: { "claim/x": { by: "u-1" } } }) }); assert.equal(d.respawn, false, d.reason);
// 6. Below the floor (majority: max(3, ceil(expected/2))) the seat is needed whatever it left behind.
d = decide({ room: room({ participants: [seat("u-0"), seat("u-1"), seat("u-2"), seat("gone", false)] }) });
assert.equal(d.respawn, true, d.reason); assert.match(d.reason, /floor/);
// 7. The verifier is always replaced: require_verification and the ending need that seat.
d = decide({ name: "verifier", room: room({ participants: [...Array.from({ length: 15 }, (_, i) => seat(`u-${i}`)), seat("verifier", false, "verifier")] }) });
assert.equal(d.respawn, true, d.reason); assert.match(d.reason, /verifier/);
// 8. A concluded or closed room never respawns, nor a missing one.
assert.equal(decide({ exitCode: 1, room: room({ state: "concluded" }) }).respawn, false);
assert.equal(decide({ exitCode: 1, room: null }).respawn, false);
// 9. Bounded retries.
assert.equal(decide({ exitCode: 1, attempt: 4 }).respawn, false);
// 10. Unanimous rooms need every expected seat.
d = decide({ room: room({ quorum: "unanimous", expected_participants: 17 }) }); assert.equal(d.respawn, true, d.reason);
// 12. The quorum floor binds only while a proposal is open: an analysis lobby thinning to 8 seats between proposals is
//     not refilled (lobby swarm-214936 was held at 16 by replacements that found nothing to do), but three seats always are.
d = decide({ room: room({ proposals: [], participants: [...Array.from({ length: 8 }, (_, i) => seat(`u-${i}`)), seat("gone", false)] }) });
assert.equal(d.respawn, false, d.reason);
d = decide({ room: room({ proposals: [{ status: "accepted" }], participants: [seat("u-0"), seat("u-1"), seat("gone", false)] }) });
assert.equal(d.respawn, true, d.reason); assert.match(d.reason, /floor of 3/);
d = decide({ room: room({ proposals: [{ status: "open" }], participants: [...Array.from({ length: 8 }, (_, i) => seat(`u-${i}`)), seat("gone", false)] }) });
assert.equal(d.respawn, true, d.reason); assert.match(d.reason, /floor of 10/);
// 13. A deliberate SIGTERM (exit 143, or a signal with no code) is an operator stopping the seat, not a crash: no respawn.
d = decide({ exitCode: 143 }); assert.equal(d.respawn, false, d.reason); assert.match(d.reason, /signal/);
d = decide({ exitCode: null }); assert.equal(d.respawn, false, d.reason);
// 11. Humans do not count toward the floor.
d = decide({ room: room({ participants: [seat("u-0"), seat("u-1"), seat("benji", true, "worker", "human"), seat("gone", false)] }) });
assert.equal(d.respawn, true, d.reason);
console.log("RESPAWN OK");
