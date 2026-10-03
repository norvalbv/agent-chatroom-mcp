/** The transcript's catch-up digest and "signal only" folding: node --import tsx scripts/ui-catchup.test.ts
 * Before: a returning human had to read every message to find what was asked of them; 200 messages of agent chatter
 * buried the handful of questions, proposals and decisions. Now a digest names what changed since they last looked
 * (questions for them first) and chatter folds, while anything said to the human always stays visible. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { UI_HTML } from "../src/ui.ts";

const PURE = /\/\*catchup-pure:start\*\/([\s\S]*?)\/\*catchup-pure:end\*\//;
const src = (UI_HTML.match(PURE) ?? ["", ""])[1];
const { cuHelpers, cuDigest } = new Function(`${src}; return { cuHelpers, cuDigest };`)();
const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const HUMANS = ["human", "user", "owner", "benji"];

let seq = 0;
const agent = (name: string, content: string, extra: object = {}) => ({ id: `m${++seq}`, seq, kind: "chat", from: { id: `p_${name}`, name, agent: "claude" }, content, ts: "2026-10-03T10:00:00Z", ...extra });
const human = (content: string, extra: object = {}) => ({ id: `m${++seq}`, seq, kind: "chat", from: { id: "p_benji", name: "benji", agent: "human" }, content, ts: "2026-10-03T10:00:00Z", ...extra });
const sys = (content: string, kind = "system") => ({ id: `m${++seq}`, seq, kind, from: { id: "system", name: "system", agent: "system" }, content, ts: "2026-10-03T10:00:00Z" });

test("the dashboard carries the catch-up helpers and wires them in", () => {
  assert.ok(src.length > 0, "catchup-pure markers found in UI_HTML");
  assert.equal(typeof cuHelpers, "function");
  assert.ok(UI_HTML.includes("catchupSelect(name);"), "select() records where the reader left off");
  assert.ok((UI_HTML.match(/catchupAfter\(\);/g) ?? []).length >= 2, "both rerender() and poll() refresh the digest and folds");
  assert.ok(UI_HTML.includes("window.crJump = catchupJump"), "other panels can jump into a fold");
});

test("a question to the human is an ask; a plain reply to the human is not", () => {
  seq = 0;
  const q = agent("opus-1", "@benji should the inbox live in the rail or the inspector?");
  const thanks = agent("opus-2", "@benji agreed, running it now.");
  const h0 = human("@all please keep tests on a private port");
  const answer = agent("astra-3", "@benji yes, private ports only? confirming", { replyTo: h0.id });
  const toOther = agent("astra-4", "@opus-1 does the hub expose this?");
  const all = [q, thanks, h0, answer, toOther];
  const h = cuHelpers(all, HUMANS);
  assert.equal(h.isAsk(q), true);
  assert.equal(h.isAsk(thanks), false, "no question mark");
  assert.equal(h.isAsk(answer), false, "a reply to the human answers them, it does not ask them");
  assert.equal(h.isAsk(toOther), false, "addressed to another agent");
});

test("an ask stays pending until the human replies to it or names the asker", () => {
  seq = 0;
  const q1 = agent("opus-1", "@benji rail or inspector?");
  const q2 = agent("astra-5", "@benji may I add a hub endpoint?");
  const unrelated = human("looks good so far");
  let all: object[] = [q1, q2, unrelated];
  let h = cuHelpers(all, HUMANS);
  assert.equal(h.answered(q1), false, "an unrelated human post does not settle an ask");
  all = [...all, human("rail please", { replyTo: q1.id }), human("@astra-5 yes, go ahead")];
  h = cuHelpers(all, HUMANS);
  assert.equal(h.answered(q1), true, "reply_to settles it");
  assert.equal(h.answered(q2), true, "naming the asker settles it");
});

test("signal keeps decisions and everything said to or by the human; chatter may fold", () => {
  seq = 0;
  const h0 = human("what is the status?");
  const all = [
    h0,
    agent("opus-1", "I think the fold should be three rows minimum"),
    agent("opus-2", "@opus-1 agreed"),
    agent("opus-1", "@benji fyi, folding is on by default now"),
    agent("astra-3", "status: two branches verified", { replyTo: h0.id }),
    agent("astra-4", "my opening", { tag: "opening" }),
    { ...agent("opus-1", "PROPOSAL prop_1: ship it"), kind: "proposal", proposalId: "prop_1" },
    { ...agent("opus-2", "votes AGREE on prop_1: ok"), kind: "vote" },
    { ...agent("opus-2", 'added board entry "claim/x"'), kind: "board" },
    sys("[SYSTEM] opus-1 (claude) joined the room."),
    sys("CONSENSUS REACHED on prop_1 v1 (5/6 agree)"),
  ];
  const h = cuHelpers(all, HUMANS);
  assert.deepEqual(all.map((m) => h.isSignal(m)), [true, false, false, true, true, true, true, true, false, false, true]);
});

test("the digest leads with what is asked of the human and counts proposals by id", () => {
  seq = 0;
  const all = [
    agent("opus-1", "old chatter before the reader left"),
    agent("opus-1", "@benji rail or inspector?"),
    { ...agent("opus-2", "PROPOSAL prop_9: x"), kind: "proposal", proposalId: "prop_9" },
    { ...agent("opus-2", "AMENDED prop_9: y"), kind: "amend", proposalId: "prop_9" },
    { ...agent("astra-3", "CHALLENGE prop_9: the weakest claim"), kind: "challenge", proposalId: "prop_9" },
    { ...agent("astra-3", "votes DISAGREE on prop_9: no"), kind: "vote" },
    sys("[SYSTEM] astra-6 (codex) left the room: done, see handoff/qa"),
  ];
  const g = cuDigest(all, 1, true, cuHelpers(all, HUMANS), esc);
  assert.equal(g.fresh, 6);
  assert.equal(g.asks.length, 1);
  assert.match(g.lines[0], /^<div class="cu-l hum"><span class="cu-k">For you<\/span>.*data-jump="2".*opus-1/);
  assert.match(g.summary, /6 new · <b class="cu-ask">1 for you<\/b> · 1 proposal \(1 amendments\)/);
  assert.ok(g.lines.some((l: string) => l.includes("prop_9 · 2 edits · last by <b>opus-2</b>")));
  assert.ok(g.lines.some((l: string) => l.includes("0 agree · 1 disagree")));
  assert.ok(g.lines.some((l: string) => l.includes("left astra-6")));
});

test("a closed room asks nothing, and nothing new means no digest", () => {
  seq = 0;
  const all = [agent("opus-1", "@benji rail or inspector?")];
  const h = cuHelpers(all, HUMANS);
  assert.equal(cuDigest(all, 1, false, h, esc), null);
  assert.equal(cuDigest(all, 1, true, h, esc).asks.length, 1, "an open room still surfaces an old unanswered ask");
});

test("message text is escaped in the digest", () => {
  seq = 0;
  const all = [agent("opus-1", '@benji is <img src=x onerror="alert(1)"> ok?')];
  const g = cuDigest(all, 0, true, cuHelpers(all, HUMANS), esc);
  assert.ok(!g.lines[0].includes("<img"), g.lines[0]);
});
