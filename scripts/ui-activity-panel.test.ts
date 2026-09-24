/** The People tab's activity panel: newest step first, a line saying what the seat is doing now, and a scroll position
 * that survives the 3-second re-render: node --import tsx scripts/ui-activity-panel.test.ts
 * Before: steps were listed oldest first, the panel was rebuilt on every poll so a reader scrolled to the bottom was thrown
 * back to the top whenever the seat took a step, and nothing separated the current step from history. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { UI_HTML } from "../src/ui.ts";

const ACT_BLOCK = /\/\*act:start\*\/([\s\S]*?)\/\*act:end\*\//;
const TOOL_N = /Tool(\d)/g;
const LATEST = /class="latest"/g;
const src = (UI_HTML.match(ACT_BLOCK) ?? ["", ""])[1];
const { actPanel, actAnchor, actRestore } = new Function(`${src}; return { actPanel, actAnchor, actRestore };`)();
const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const rel = (ts: string) => `rel(${ts})`;
const steps = [1, 2, 3].map((n) => ({ step: n, at: `2026-09-24T10:00:0${n}Z`, tool: `Tool${n}`, detail: `detail ${n}` }));

test("the extracted helpers exist", () => {
  assert.ok(src.length > 0, "markers found in UI_HTML");
  assert.equal(typeof actPanel, "function");
});

test("steps are listed newest first and the newest is marked", () => {
  const html = actPanel({ active: true, last_active_at: "2026-09-24T10:00:09Z" }, steps, esc, rel);
  const order = [...html.matchAll(TOOL_N)].map((m) => m[1]);
  assert.deepEqual(order, ["3", "2", "1"]);
  assert.ok(html.includes('class="latest"><span class="st">#3 '));
  assert.equal((html.match(LATEST) ?? []).length, 1);
});

test("a seat running a tool shows what it is doing now, above the history", () => {
  const p = { active: true, last_active_at: "2026-09-24T10:00:02Z", working: { tool: "Bash", at: "2026-09-24T10:00:05Z", detail: "npm test" } };
  const html = actPanel(p, steps, esc, rel);
  assert.ok(html.startsWith('<div class="now live"><span class="dot"></span>Now: <span class="tl">Bash</span> npm test <span class="st">· started rel(2026-09-24T10:00:05Z)</span></div>'), html);
  assert.ok(html.indexOf("Now:") < html.indexOf("Recent steps"));
});

test("a seat whose last act was in the room, or that left, says so instead", () => {
  const idle = actPanel({ active: true, last_active_at: "2026-09-24T10:00:09Z", working: { tool: "Bash", at: "2026-09-24T10:00:05Z" } }, steps, esc, rel);
  assert.ok(idle.startsWith('<div class="now">Not running a tool · last active in the room rel(2026-09-24T10:00:09Z)</div>'), idle);
  const left = actPanel({ active: false, left_reason: "done" }, steps, esc, rel);
  assert.ok(left.startsWith('<div class="now off">Left the room: done</div>'), left);
  assert.equal(actPanel({ active: true }, undefined, esc, rel), "Loading…");
  assert.ok(actPanel({ active: true }, [], esc, rel).includes("No heartbeats yet"));
});

test("a reader at the top keeps following the newest step", () => {
  const before = [{ k: "3", top: 40, height: 20 }, { k: "2", top: 60, height: 20 }];
  const after = [{ k: "4", top: 40, height: 20 }, { k: "3", top: 60, height: 20 }, { k: "2", top: 80, height: 20 }];
  assert.equal(actRestore(actAnchor(0, before), after), 0);
});

test("a reader scrolled down keeps their row in place when a new step arrives and the oldest drops off", () => {
  // rows 20px tall under a 40px header; the reader has scrolled so row "2" starts 5px below the top edge
  const before = [3, 2, 1].map((n, i) => ({ k: String(n), top: 40 + i * 20, height: 20 }));
  const anchor = actAnchor(55, before); // row "3" spans 40-60, so it is the first row still visible
  assert.equal(anchor.k, "3");
  const after = [4, 3, 2].map((n, i) => ({ k: String(n), top: 40 + i * 20, height: 20 }));
  assert.equal(actRestore(anchor, after), 75, "row 3 moved down 20px, so the scroll moves with it");
  const gone = [9, 8, 7].map((n, i) => ({ k: String(n), top: 40 + i * 20, height: 20 }));
  assert.equal(actRestore(anchor, gone), 55, "if the row is gone, the old offset is kept rather than jumping to the top");
});
