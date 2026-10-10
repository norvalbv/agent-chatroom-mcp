/** The dashboard shows what a run is costing while it runs (swarm-082539-kns2, telemetry). The hub holds each seat's
 * seat-reported usage live (participants[].usage and the room's usage total, src/hub/usage.ts), but before this the owner
 * saw a cost only in the launcher's pre-run guide and in report.md after the end: dev room swarm-083403-832k reached
 * $1.70 in 2.5 minutes with no figure on screen. A seat that reported nothing shows no cost, never "$0.00".
 * node --import tsx scripts/ui-cost.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { UI_HTML } from "../src/ui.ts";

const ACT_BLOCK = /\/\*act:start\*\/([\s\S]*?)\/\*act:end\*\//;
const src = (UI_HTML.match(ACT_BLOCK) ?? ["", ""])[1];
const helpers = new Function(`${src}; return { actPanel, personStatus, usageText: typeof usageText === "function" ? usageText : undefined };`)();
const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const rel = (ts: string) => `rel(${ts})`;
const usage = { requests: 17, input_tokens: 5224, output_tokens: 2393, cache_read_input_tokens: 180107, cache_creation_input_tokens: 15433, cost_usd: 0.4193139, by_model: { "claude-opus-5-5": { requests: 16, cost_usd: 0.419 }, "claude-haiku-5-5": { requests: 1, cost_usd: 0.0003 } } };
const idle = { active: true, messages: 5, last_active_at: "2026-10-10T08:00:00Z", last_seen_at: "2026-10-10T08:00:00Z" };

test("a seat's row shows its seat-reported cost next to its message count", () => {
  const s = helpers.personStatus({ ...idle, usage }, esc, rel);
  assert.match(s, /^5 msgs · \$0\.42 · /, s);
  const busy = helpers.personStatus({ ...idle, usage, working: { tool: "Bash", at: "2026-10-10T08:00:05Z", detail: "x".repeat(300) } }, esc, rel);
  assert.match(busy, /^5 msgs · \$0\.42 · /, "a long command never pushes the cost out of the row");
});

test("a seat that reported nothing shows no cost, not $0.00", () => {
  const s = helpers.personStatus(idle, esc, rel);
  assert.doesNotMatch(s, /\$/, s);
});

test("the room total and the open panel say seat-reported, with calls and tokens", () => {
  assert.equal(typeof helpers.usageText, "function", "usageText exists in the act block");
  assert.equal(helpers.usageText({ requests: 59, cost_usd: 1.7017368, seats: 4, input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }), "$1.70 seat-reported · 59 model calls · 4 seats");
  assert.equal(helpers.usageText(undefined), "");
  const panel = helpers.actPanel({ ...idle, usage }, [], esc, rel);
  assert.match(panel, /\$0\.42 seat-reported · 17 model calls/);
  assert.match(panel, /5224 input · 180107 cache-read · 15433 cache-write · 2393 output tokens/);
  assert.match(panel, /claude-opus-5-5 16/);
});
