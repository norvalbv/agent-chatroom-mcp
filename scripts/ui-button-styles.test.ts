/** Every <button> in the dashboard carries at least one class that the stylesheet styles: node --import tsx scripts/ui-button-styles.test.ts
 * The kick/replace buttons used class "mini", which had no rule, so they fell back to the browser's light default
 * button with inherited light text, unreadable in dark mode. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { UI_HTML } from "../src/ui.ts";

test("every class list on a dashboard button includes a styled class", () => {
  const css = (UI_HTML.match(/<style>([\s\S]*?)<\/style>/) ?? ["", ""])[1];
  const styled = (cls: string) => new RegExp(`\\.${cls.replace(/[-]/g, "\\-")}(?![\\w-])`).test(css);
  const lists = [...UI_HTML.matchAll(/<button[^>]*\sclass="([^"]+)"/g)].map((m) => m[1].split(/\s+/).filter((c) => /^[a-z][\w-]*$/i.test(c))).filter((classes) => classes.length); // class lists built in script are skipped
  assert.ok(lists.length > 0, "found dashboard buttons");
  const unstyled = lists.filter((classes) => !classes.some(styled)).map((c) => c.join(" "));
  assert.deepEqual([...new Set(unstyled)], [], `button classes with no style rule: ${[...new Set(unstyled)].join(", ")}`);
});
