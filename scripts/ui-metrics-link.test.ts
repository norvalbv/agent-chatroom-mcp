/** The dashboard links each room to its run metrics: node --import tsx --test scripts/ui-metrics-link.test.ts
 * GET /rooms/<room>/metrics?format=md had the per-seat table and the timeline (when the room went quiet, cost per half
 * hour, context per seat), but nothing in the dashboard pointed at it, so the owner read it only if a seat pasted it. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { UI_HTML } from "../src/ui.ts";

test("the room header has a Metrics link beside Transcript", () => {
  assert.match(UI_HTML, /href="\/rooms\/' \+ encodeURIComponent\(r\.name\) \+ '\/metrics\?format=md" target="_blank"[^>]*>Metrics<\/a>/);
});
