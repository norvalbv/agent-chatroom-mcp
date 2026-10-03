import assert from "node:assert/strict";
import { test } from "node:test";
import { UI_HTML } from "../src/ui.ts";

const source = UI_HTML.slice(UI_HTML.indexOf("  function paneBoard("), UI_HTML.indexOf("  function paneStats("));
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const board = Object.fromEntries([
  ["idea/first", "keyboard review"],
  ["idea/second", "glass"],
  ["evidence/test", "keyboard tested"],
  ["handoff/owner", "ready"],
  ["draft/plan", "candidate"],
  ["custom/note", "misc"],
  ['idea/\"><img src=x onerror=alert(1)>', "<script>bad()</script>"],
].map(([key, text]) => [key, { text, by: "tester", updated_at: "2026-10-03T10:00:00Z", chars: text.length }]));
const render = (query = "", category = "", expanded = {}) => new Function("boardQuery", "boardCategory", "expanded", "esc", "rel", "withMentions", `${source}; return paneBoard;`)(query, category, expanded, esc, () => "now", (v: string) => v)({ board });

test("board categories have counts and preserve evidence, ideas, handoffs, and drafts", () => {
  const html = render();
  assert.match(html, /Ideas \(3\)/);
  assert.match(html, /Evidence \(1\)/);
  assert.match(html, /Handoffs \(1\)/);
  assert.match(html, /Drafts \(1\)/);
  assert.match(html, /Notes \(1\)/);
});

test("category and text filters intersect without hiding category totals", () => {
  const html = render("keyboard", "idea");
  assert.match(html, /data-b="idea\/first"/);
  assert.doesNotMatch(html, /data-b="evidence\/test"|data-b="idea\/second"/);
  assert.match(html, /Ideas \(3\)/);
  assert.match(render("no matches", "idea"), /No entry matches/);
});

test("board disclosures are native buttons with accurate expanded state", () => {
  const html = render("keyboard", "idea", { "b:idea/first": true });
  assert.match(html, /<button[^>]+aria-expanded="true"[^>]+data-b="idea\/first"/);
  assert.match(render(), /<button[^>]+aria-expanded="false"/);
});

test("board entry keys and text stay escaped in categories and disclosures", () => {
  const html = render();
  assert.doesNotMatch(html, /<img|<script>/);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.match(html, /data-b="idea\/&quot;&gt;&lt;img/);
});

const focusSource = UI_HTML.slice(UI_HTML.indexOf("  function boardCaptureFocus("), UI_HTML.indexOf("  function paneBoard("));
function focusFixture() {
  const document: { activeElement: any } = { activeElement: null };
  const calls: unknown[] = [];
  const node = (id: string, key?: string) => ({
    id, dataset: { b: key }, value: "", selectionStart: 2, selectionEnd: 5, selectionDirection: "backward",
    matches: () => true,
    focus() { document.activeElement = this; },
    setSelectionRange(start: number, end: number, direction: string) { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; },
    oninput: null as any, onchange: null as any, onblur: null as any, onkeydown: null as any,
  });
  const pane = { contains: (element: unknown) => Object.values(nodes).includes(element as any) };
  const nodes = { bsearch: node("bsearch"), bcategory: node("bcategory"), disclosure: node("", 'idea/"weird') };
  const $ = (selector: string) => selector === "#pane" ? pane : nodes[selector.slice(1) as keyof typeof nodes];
  const $$ = () => nodes.disclosure ? [nodes.disclosure] : [];
  const helpers = new Function("document", "$", "$$", "renderPane", "setTimeout", `var tab = 'board', boardQuery = 'keyboard', boardCategory = ''; ${focusSource}; return { boardCaptureFocus, boardBindControls };`)(document, $, $$, (force: unknown) => calls.push(force), (callback: () => void) => callback());
  return { document, calls, node, nodes, pane, ...helpers };
}

test("poll rendering preserves a board search selection without stealing outside focus", () => {
  const f = focusFixture();
  f.document.activeElement = f.nodes.bsearch;
  const focus = f.boardCaptureFocus(f.pane);
  f.nodes.bsearch = f.node("bsearch");
  f.nodes.bsearch.selectionStart = 0;
  f.nodes.bsearch.selectionEnd = 0;
  f.boardBindControls(focus);
  assert.equal(f.document.activeElement, f.nodes.bsearch);
  assert.equal(f.nodes.bsearch.value, "keyboard");
  assert.equal(f.nodes.bsearch.selectionStart, 2);
  assert.equal(f.nodes.bsearch.selectionEnd, 5);
  assert.equal(f.nodes.bsearch.selectionDirection, "backward");
  const composer = f.node("text");
  f.document.activeElement = composer;
  f.boardBindControls(f.boardCaptureFocus(f.pane));
  assert.equal(f.document.activeElement, composer);
});

test("disclosure focus matches exact keys and falls back to search after deletion", () => {
  const f = focusFixture();
  f.document.activeElement = f.nodes.disclosure;
  const focus = f.boardCaptureFocus(f.pane);
  f.nodes.disclosure = f.node("", 'idea/"weird');
  f.boardBindControls(focus);
  assert.equal(f.document.activeElement, f.nodes.disclosure);
  delete f.nodes.disclosure;
  f.boardBindControls(focus);
  assert.equal(f.document.activeElement, f.nodes.bsearch);
});

test("category controls refresh on change and blur, and keep their own keyboard events", () => {
  const f = focusFixture();
  f.boardBindControls(null);
  f.nodes.bcategory.onchange();
  f.nodes.bcategory.onblur();
  assert.deepEqual(f.calls, [true, undefined]);
  let stopped = false;
  f.nodes.bcategory.onkeydown({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
});
