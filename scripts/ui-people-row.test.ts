/** The People tab's rows, readable in a narrow sidebar (benji, swarm-082539-kns2 #150, with a screenshot): a name wrapped at
 * every hyphen ("claude-/opus-/5-5-3"), a claimed area cut to four letters ("tele…"), "working: Bash" saying nothing
 * about what the seat is doing, and a "Now:" line that was mostly a `cd "/Users/…/agent-chatroom-mcp";` prefix.
 * node --import tsx scripts/ui-people-row.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { UI_HTML } from "../src/ui.ts";

const ACT_BLOCK = /\/\*act:start\*\/([\s\S]*?)\/\*act:end\*\//;
const src = (UI_HTML.match(ACT_BLOCK) ?? ["", ""])[1];
const helpers = new Function(`${src}; return { actPanel: typeof actPanel === "function" ? actPanel : undefined, stepText: typeof stepText === "function" ? stepText : undefined, personStatus: typeof personStatus === "function" ? personStatus : undefined };`)();
const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const rel = (ts: string) => `rel(${ts})`;
const ROOT = "/Users/benji/Desktop/Personal and learning/agent-chatroom-mcp";
const WT = `${ROOT}/.swarm-worktrees/swarm-082539-kns2/claude-opus-5-5-2`;

test("a step drops its cd and env prefix and shows repo paths relative", () => {
  const { stepText } = helpers;
  assert.equal(typeof stepText, "function", "stepText exists in the act block");
  assert.equal(stepText("Bash", `cd "${ROOT}"; grep -o '"type"' logs/hub-7741/data/x.jsonl | sort`), `grep -o '"type"' logs/hub-7741/data/x.jsonl | sort`);
  assert.equal(stepText("Bash", `cd "${WT}" && PORT=7820 npx tsx scripts/smoke.ts`), "npx tsx scripts/smoke.ts");
  assert.equal(stepText("Read", `${WT}/src/ui.ts`), "src/ui.ts");
  assert.equal(stepText("Grep", `pattern in ${ROOT}/src`), "pattern in src");
  assert.equal(stepText("Bash", "  npm   test  "), "npm test");
  assert.equal(stepText("Bash", ""), "");
  assert.equal(stepText("Bash", undefined), "");
});

test("the row's status line says what the seat is running, not just the tool", () => {
  const { personStatus } = helpers;
  assert.equal(typeof personStatus, "function", "personStatus exists in the act block");
  const busy = { active: true, messages: 5, last_active_at: "2026-10-10T08:00:00Z", working: { tool: "Bash", at: "2026-10-10T08:00:05Z", detail: `cd "${ROOT}"; grep -c x logs/a.jsonl` } };
  const s = personStatus(busy, esc, rel);
  assert.ok(s.includes("5 msgs"), s);
  assert.ok(s.includes("Bash"), s);
  assert.ok(s.includes("grep -c x logs/a.jsonl"), s);
  assert.ok(!s.includes("/Users/"), s);
  assert.ok(s.includes("rel(2026-10-10T08:00:05Z)"), s);
  const long = personStatus({ ...busy, working: { ...busy.working, detail: "x".repeat(300) } }, esc, rel);
  assert.ok(long.length < 400, "a long command is shortened in the row; the panel shows it whole");
  const idle = personStatus({ active: true, messages: 1, last_active_at: "2026-10-10T08:00:09Z", working: { tool: "Bash", at: "2026-10-10T08:00:05Z" } }, esc, rel);
  assert.ok(idle.includes("1 msg") && !idle.includes("1 msgs") && !idle.includes("Bash"), idle);
  assert.ok(personStatus({ active: false, messages: 2 }, esc, rel).includes("left"));
});

test("the Now line in the open panel is cleaned the same way", () => {
  const p = { active: true, last_active_at: "2026-10-10T08:00:00Z", working: { tool: "Bash", at: "2026-10-10T08:00:05Z", detail: `cd "${ROOT}"; npm test` } };
  const html = helpers.actPanel(p, [{ step: 1, at: "2026-10-10T08:00:05Z", tool: "Bash", detail: `cd "${ROOT}"; npm test` }], esc, rel);
  assert.ok(!html.includes("/Users/"), html);
  assert.ok(html.includes("npm test"), html);
});

test("names stay on one line and the claimed area is not cut to a few letters", () => {
  assert.match(UI_HTML, /\.person \.n \{[^}]*white-space:nowrap/, "the name line does not wrap at hyphens");
  assert.doesNotMatch(UI_HTML, /\.person \.a \{[^}]*white-space:nowrap/, "the area line may wrap instead of being cut");
  assert.doesNotMatch(UI_HTML, /grid-template-columns:28px minmax\(0,1fr\) auto auto/, "no fourth column squeezing the name");
});
