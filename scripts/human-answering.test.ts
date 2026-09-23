/** Offline human-answer predicate regressions. Run: npx tsx scripts/human-answering.test.ts */
import assert from "node:assert/strict";
import { Hub } from "../src/hub.js";

let passed = 0;
let failed = 0;
function test(name: string, run: () => void) {
  try {
    run();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : error}`);
  }
}

function fixture(anonymous = false, humanName = "Ben") {
  const hub = new Hub(); // No dataDir: no server, disk state, or timers required.
  const room = hub.createRoom("human-answering", { expectedParticipants: 0, anonymous });
  const a = hub.join(room.name, "union-alpha-28", "claude", {}, undefined, "session-a").participant;
  const b = hub.join(room.name, "reviewer", "codex", {}, undefined, "session-b").participant;
  const human = hub.join(room.name, humanName, "human").participant;
  const ask = (content = "Can you check the evidence?") => hub.send(room.name, human.id, content);
  const say = (content: string, replyTo?: string) => hub.send(room.name, a.id, content, replyTo, true);
  return { hub, room, a, b, human, ask, say };
}

for (const content of ["The Rebench numbers look fine.", "@everyone the Rebench numbers look fine.", "Benson checked the figures."]) {
  test(`substring does not answer: ${content}`, () => {
    const f = fixture();
    const question = f.ask();
    const message = f.say(content);
    // Isolate the fallback from addressedHuman's automatic reply_to inference.
    delete message.replyTo;
    assert.equal(f.hub.isAnswered(f.room, question), false);
    assert.equal(f.hub.unansweredHuman(f.room)?.id, question.id);
  });
}

test("send must not infer reply_to from substring-only chatter", () => {
  const f = fixture();
  f.ask();
  const content = "@everyone the Rebench numbers look fine.";
  assert.equal(f.hub.addressedHuman(f.room, content), undefined);
  assert.equal(f.say(content).replyTo, undefined);
});

test("honest mixed-case name answers without reply_to", () => {
  const f = fixture();
  const question = f.ask();
  const reply = f.say("bEn, the figures are correct.");
  // Exercise isAnswered's name fallback independently of send's reply_to inference.
  delete reply.replyTo;
  assert.equal(f.hub.isAnswered(f.room, question), true);
});

test("explicit reply_to answers without naming the human", () => {
  const f = fixture();
  const question = f.ask();
  f.say("The figures are correct.", question.id);
  assert.equal(f.hub.isAnswered(f.room, question), true);
});

test("later human message stops implicit names answering an older question", () => {
  const f = fixture();
  const older = f.ask("Can you check the first figure?");
  const newer = f.ask("Can you check the second figure?");
  const reply = f.say("Ben, the second figure is correct.");
  delete reply.replyTo;
  assert.equal(f.hub.isAnswered(f.room, older), false);
  assert.equal(f.hub.isAnswered(f.room, newer), true);
  f.say("The first figure is correct too.", older.id);
  assert.equal(f.hub.isAnswered(f.room, older), true, "reply_to still answers older questions");
});

for (const content of ["@union-alpha-28 I have evidence.", "@UNION-ALPHA-28 a question?", "@union-alpha-28: please check."]) {
  test(`exact addressee: ${content}`, () => {
    const f = fixture();
    const question = f.ask(content);
    assert.equal(f.hub.addressee(f.room, question), f.a.id);
    assert.equal(f.hub.responderFor(f.room, question, f.b.id).mine, false);
    assert.equal(f.hub.responderFor(f.room, question, f.a.id).mine, true);
  });
}

for (const content of ["@B I have evidence.", "@Participant B I have evidence."]) {
  test(`anonymous addressee: ${content}`, () => {
    const f = fixture(true);
    const question = f.ask(content);
    assert.equal(f.hub.addressee(f.room, question), f.b.id);
  });
}

for (const content of ["@all I have evidence.", "@everyone I have evidence."]) {
  test(`broadcast addressee: ${content}`, () => {
    const f = fixture();
    assert.equal(f.hub.addressee(f.room, f.ask(content)), "all");
  });
}

test("unknown longer token does not nominate a prefix name", () => {
  const f = fixture();
  assert.equal(f.hub.addressee(f.room, f.ask("@union-alpha-28-extra I have evidence.")), undefined);
});

test("propose gate warns after substring-only chatter, then allows a real reply", () => {
  const f = fixture();
  const question = f.ask();
  f.say("The Rebench numbers look fine.");
  assert.throws(() => f.hub.propose(f.room.name, f.a.id, "Adopt the checked figures."), /nobody has answered/);
  assert.equal(f.room.proposals.size, 0);
  f.say("Yes, the figures are checked.", question.id);
  assert.equal(f.hub.unansweredHuman(f.room), undefined);
  assert.equal(f.hub.propose(f.room.name, f.a.id, "Adopt the checked figures.").status, "open");
});

test("real cased reply allows first proposal without spending the warning", () => {
  const f = fixture();
  const question = f.ask();
  f.say("bEN, I checked the figures.");
  assert.equal(f.room.humanWarned.has(question.id), false);
  assert.equal(f.hub.propose(f.room.name, f.a.id, "Adopt the checked figures.").status, "open");
  assert.equal(f.room.humanWarned.has(question.id), false);
});

console.log(`HUMAN ANSWERING: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
else console.log("HUMAN ANSWERING OK");
