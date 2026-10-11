/** The People tab shows what each seat has TAKEN (owner via the chair, swarm-180216-182a #104, board inputs/owner-1): the
 * row was drawn only from claim/* entries and the hub-assigned reviewer, so a seat doing review/c0dd54e4 under
 * take/review/c0dd54e4 showed "reviewing: inbox-cap, launcher-bugs" (assigned, not done) and nothing it had taken.
 * room_status already lists take/* per seat as `holds` and `offered`; the row now reads them.
 * node --import tsx scripts/ui-people-takes.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { UI_HTML } from "../src/ui.ts";

const ACT_BLOCK = /\/\*act:start\*\/([\s\S]*?)\/\*act:end\*\//;
const src = (UI_HTML.match(ACT_BLOCK) ?? ["", ""])[1];
const { personWork } = new Function(`${src}; return { personWork: typeof personWork === "function" ? personWork : undefined };`)();
const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const board = {
  "claim/board-append": { by: "s4", text: "{}" },
  "take/review/c0dd54e4": { by: "s4", text: "reviewing c0dd54e4 (session reap) now" },
  "take/Q11": { by: "s3", text: "@s4 Q11 is yours" },
};

test("a seat's takes are on its row, after its areas, with the take's line as the tooltip", () => {
  assert.equal(typeof personWork, "function", "personWork exists in the act block");
  const p = { name: "s4", holds: ["claim/board-append", "take/review/c0dd54e4"], offered: [{ key: "take/Q11", by: "s3" }] };
  const html = personWork(p, board, ["board-append"], ["inbox-cap"], esc);
  assert.ok(html.includes("board-append"), html);
  assert.match(html, /taking: <span title="reviewing c0dd54e4 \(session reap\) now">review\/c0dd54e4<\/span>/);
  assert.match(html, /offered: <span title="@s4 Q11 is yours">Q11<\/span> by s3/);
  assert.ok(html.indexOf("board-append") < html.indexOf("taking:") && html.indexOf("taking:") < html.indexOf("reviewing: inbox-cap"), html);
  assert.ok(!/claim\/board-append/.test(html), "claims stay areas, not listed twice as takes");
});

test("a seat with no takes renders as before, and a left seat keeps its reason", () => {
  assert.equal(personWork({ name: "s1" }, board, ["consensus"], [], esc), "consensus");
  assert.equal(personWork({ name: "s1", left_reason: "done" }, board, [], [], esc), "left: done");
});

test("the row is built from personWork, and the help line names takes", () => {
  assert.match(UI_HTML, /var aline = personWork\(p, r\.board/);
  assert.match(UI_HTML, /taking is what a seat wrote under take\/\*/);
});
