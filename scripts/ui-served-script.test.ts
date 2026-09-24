/** The dashboard's inline script as the browser receives it: node --import tsx scripts/ui-served-script.test.ts
 * UI_HTML is a template literal, so a single backslash in its script loses itself when served: the recruit-policy
 * button split its input on /s+/ (the letter s) instead of /\s+/ until 2026-09-24. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { UI_HTML } from "../src/ui.ts";

const SCRIPT = /<script>([\s\S]*?)<\/script>/g;
const scripts = [...UI_HTML.matchAll(SCRIPT)].map((m) => m[1]);

test("every served inline script parses", () => {
  assert.ok(scripts.length > 0);
  for (const s of scripts) assert.doesNotThrow(() => new Function(s));
});

test("the recruit-policy input splits on whitespace, not on the letter s", () => {
  const i = UI_HTML.indexOf("v.trim().split(");
  assert.ok(i > 0);
  assert.equal(UI_HTML.slice(i, i + "v.trim().split(/\\s+/)".length), "v.trim().split(/\\s+/)");
});
