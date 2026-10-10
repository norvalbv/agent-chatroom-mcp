/** The dashboard's chat poll draws each seq once: node --import tsx scripts/ui-poll-dedupe-regression.test.ts
 * Before: poll() ran on a 1500 ms setInterval with no in-flight guard and appended every returned message, so on a
 * loaded machine two overlapping polls asked for the same ?since= and both drew the batch (#52 showed twice).
 * Now poll() returns while a fetch is pending, and skips any message whose seq it has already drawn. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { UI_HTML } from "../src/ui.ts";

const start = UI_HTML.indexOf("async function poll()");
const end = UI_HTML.indexOf("// ---------- inspector", start);
assert.ok(start > 0 && end > start, "poll() found in UI_HTML");
const pollSrc = UI_HTML.slice(start, end);

const msg = (seq: number) => ({ id: `m${seq}`, seq, kind: "chat", from: { name: "a", agent: "claude" }, content: `m${seq}`, ts: "2026-10-10T10:00:00Z" });

/** Run the served poll() against a fake hub whose /messages answers after `delay` ms. */
function harness(delay: number, store: { seq: number }[], ignoreSince = false) {
  const drawn: number[] = [];
  const el = { appendChild() {}, style: {}, dataset: {}, set innerHTML(_: string) {}, set textContent(_: string) {} };
  const fetchFake = async (url: string) => {
    const since = Number(/since=(\d+)/.exec(url)![1]);
    await new Promise((r) => setTimeout(r, delay));
    return { ok: true, json: async () => store.filter((m) => ignoreSince || m.seq > since) };
  };
  const body = `var polling = false, sel = 'r', seen = 0, msgs = [], lastSender = null, unreadPill = 0, tab = 'x', cur = null;
    var $ = function () { return el; }; var atBottom = function () { return true; }; var toBottom = function () {};
    var renderMsg = function (m) { drawn.push(m.seq); }; var renderPins = function () {}; var catchupAfter = function () {};
    var renderPane = function () {};
    ${pollSrc}
    return poll;`;
  const poll = new Function("fetch", "el", "drawn", "document", body)(fetchFake, el, drawn, { body: { dataset: {} }, createElement: () => el }) as () => Promise<void>;
  return { poll, drawn };
}

test("two overlapping polls on a slow hub draw each seq once", async () => {
  const { poll, drawn } = harness(60, [msg(1), msg(2), msg(3)]);
  const a = poll();
  await new Promise((r) => setTimeout(r, 20)); // the next 1500 ms tick lands while the first fetch is pending
  const b = poll();
  await Promise.all([a, b]);
  assert.deepEqual(drawn, [1, 2, 3]);
});

test("a batch that repeats seqs already drawn is not drawn again", async () => {
  const { poll, drawn } = harness(0, [msg(1), msg(2), msg(3)], true); // every answer is the whole log, whatever ?since= said
  await poll();
  await poll();
  assert.deepEqual(drawn, [1, 2, 3]);
});

test("the guard releases after a failed fetch", async () => {
  let calls = 0;
  const drawn: number[] = [];
  const el = { appendChild() {}, style: {}, dataset: {}, set innerHTML(_: string) {}, set textContent(_: string) {} };
  const fetchFake = async () => { if (++calls === 1) throw new Error("down"); return { ok: true, json: async () => [msg(1)] }; };
  const body = `var polling = false, sel = 'r', seen = 0, msgs = [], lastSender = null, unreadPill = 0, tab = 'x', cur = null;
    var $ = function () { return el; }; var atBottom = function () { return true; }; var toBottom = function () {};
    var renderMsg = function (m) { drawn.push(m.seq); }; var renderPins = function () {}; var catchupAfter = function () {};
    var renderPane = function () {}; ${pollSrc} return poll;`;
  const poll = new Function("fetch", "el", "drawn", "document", body)(fetchFake, el, drawn, { body: { dataset: {} }, createElement: () => el }) as () => Promise<void>;
  await poll();
  await poll();
  assert.deepEqual(drawn, [1]);
});
