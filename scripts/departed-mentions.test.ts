/** Offline departed-address regressions. Run: npx tsx scripts/departed-mentions.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Hub, HubError } from "../src/hub.js";

function fixture(anonymous = false, mode: "free" | "round_robin" = "free") {
  const hub = new Hub();
  const { room, participant: sender } = hub.join("departed-mentions", "sender", "test", { anonymous, mode, expectedParticipants: 0 });
  const target = hub.join(room.name, "reviewer", "test").participant;
  const observer = hub.join(room.name, "observer", "test").participant;
  return { hub, room, sender, target, observer };
}

function snapshot(room: ReturnType<typeof fixture>["room"]) {
  return JSON.stringify(room, (key, value) => key === "nudgeTimer" || key === "openingsTimer" ? undefined : value instanceof Map ? [...value.entries()] : value instanceof Set ? [...value] : value);
}

function refusesWithoutMutation(f: ReturnType<typeof fixture>, content: string, options: { force?: boolean; quiet?: boolean; surface?: boolean; replyTo?: string } = {}) {
  const before = snapshot(f.room);
  const timers = [f.room.nudgeTimer, f.room.openingsTimer];
  assert.throws(
    () => f.hub.send(f.room.name, f.sender.id, content, options.replyTo, options.force ?? true, options.quiet ?? false, options.surface ?? false),
    (error: unknown) => error instanceof HubError && /reviewer/i.test(error.message) && /left|departed|inactive/i.test(error.message),
    "departed mention must throw HubError naming reviewer",
  );
  assert.equal(snapshot(f.room), before, "refusal must not change any room, message, participant or delivery state");
  assert.equal(f.room.nudgeTimer, timers[0], "nudge timer must be unchanged");
  assert.equal(f.room.openingsTimer, timers[1], "openings timer must be unchanged");
}

for (const anonymous of [false, true]) {
  for (const mention of ["@reviewer", "@REVIEWER", "@B", "@Participant B", "(@reviewer),"]) {
    for (const quiet of [false, true]) {
      test(`departed target rejected: ${mention}, anonymous=${anonymous}, quiet=${quiet}`, () => {
        const f = fixture(anonymous);
        f.hub.leave(f.room.name, f.target.id);
        refusesWithoutMutation(f, `${mention} please respond`, { quiet });
      });
    }
  }
}

for (const quiet of [false, true]) {
  test(`mixed active and departed recipients rejected atomically, quiet=${quiet}`, () => {
    const f = fixture();
    f.hub.leave(f.room.name, f.target.id);
    refusesWithoutMutation(f, "@observer and @reviewer please respond", { quiet });
  });
}

test("departed refusal precedes stale-send cursor settlement", () => {
  const f = fixture();
  f.hub.leave(f.room.name, f.target.id);
  refusesWithoutMutation(f, "@reviewer please respond", { force: false });
});

test("departed refusal does not surface an existing quiet thread", () => {
  const f = fixture();
  const parent = f.hub.send(f.room.name, f.sender.id, "@observer working evidence", undefined, true, true);
  f.hub.leave(f.room.name, f.target.id);
  refusesWithoutMutation(f, "@reviewer review this thread", { replyTo: `#${parent.seq}`, surface: true });
});

test("departed refusal does not advance round-robin turn", () => {
  const f = fixture(false, "round_robin");
  f.hub.leave(f.room.name, f.target.id);
  refusesWithoutMutation(f, "@reviewer please respond");
});

test("similar respawn name is not an authenticated replacement", () => {
  const f = fixture();
  f.hub.leave(f.room.name, f.target.id);
  const other = f.hub.join(f.room.name, "reviewer-r1", "test").participant;
  assert.notEqual(other.id, f.target.id);
  refusesWithoutMutation(f, "@reviewer please respond");
  assert.throws(() => f.hub.send(f.room.name, f.sender.id, "@reviewer please respond", undefined, true), (error: unknown) => error instanceof HubError && !error.message.includes("reviewer-r1"));
  assert.deepEqual(f.hub.send(f.room.name, f.sender.id, "@reviewer-r1 please respond", undefined, true).mentions, [other.id]);
});

test("explicit pid reclaim reactivates the original target and permits delivery", () => {
  const f = fixture();
  f.hub.leave(f.room.name, f.target.id);
  refusesWithoutMutation(f, "@reviewer please respond");
  const rejoined = f.hub.join(f.room.name, "reviewer", "test", {}, f.target.id).participant;
  assert.equal(rejoined.id, f.target.id);
  assert.equal(rejoined.active, true);
  const message = f.hub.send(f.room.name, f.sender.id, "@reviewer please respond", undefined, true, true);
  assert.deepEqual(message.mentions, [f.target.id]);
  assert.ok(message.audience?.includes(rejoined.id));
});

test("human sends also refuse departed names", () => {
  const f = fixture();
  f.sender.agent = "human";
  f.hub.leave(f.room.name, f.target.id);
  refusesWithoutMutation(f, "@reviewer can you respond?");
});

test("active mentions, unknown names and broadcast remain accepted", () => {
  const f = fixture();
  assert.deepEqual(f.hub.send(f.room.name, f.sender.id, "@reviewer please respond", undefined, true).mentions, [f.target.id]);
  f.hub.leave(f.room.name, f.target.id);
  for (const content of ["@unknown please respond", "@reviewer-extra please respond", "@all please respond", "@everyone please respond", "no addressing here"]) {
    assert.doesNotThrow(() => f.hub.send(f.room.name, f.sender.id, content, undefined, true));
  }
});
