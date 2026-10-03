import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { PHOTOS_JS } from "../src/ui/photos.js";

function fixture(fetch: (url: string, options: { body: unknown }) => Promise<unknown>) {
  const handlers: Record<string, (event: { preventDefault: () => void }) => Promise<void>> = {};
  const elements: Record<string, any> = {};
  const node = () => ({ value: "", style: {}, textContent: "", disabled: false, setAttribute() {}, append() {}, appendChild() {}, replaceChildren() {}, focus() {}, click() {}, addEventListener(type: string, fn: typeof handlers[string]) { handlers[type] = fn; } });
  const context: Record<string, any> = {
    Map, Array, String, Error,
    sel: "room-one", document: { createElement: node },
    $: (id: string) => elements[id] ??= node(),
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    hdrs: () => ({ "content-type": "application/json" }), myName: () => "benji", poll() {}, fetch,
  };
  runInNewContext(PHOTOS_JS, context);
  context.addPhotos([{ name: "photo.png", type: "image/png", size: 30 }]);
  return { context, elements, send: () => handlers.submit({ preventDefault() {} }) };
}

const image = { url: "/attachments/12345678-1234-1234-1234-123456789abc.png", path: "/private/photos/image.png" };
const success = { ok: true, json: async () => image };

test("a refused final message preserves photos and retries without uploading twice", async () => {
  const calls: string[] = [];
  let refused = true;
  const f = fixture(async (url) => {
    calls.push(url);
    if (url.endsWith("/attachments")) return success;
    return refused ? { ok: false, text: async () => "Message exceeds room limit" } : success;
  });
  f.elements["#text"].value = "Please inspect";
  await f.send();
  assert.equal(f.context.photosFor("room-one").length, 1);
  assert.equal(f.elements["#text"].value, "Please inspect");
  assert.match(f.elements["#hint"].textContent, /Message exceeds room limit/);
  refused = false;
  await f.send();
  assert.equal(calls.filter((url) => url.endsWith("/attachments")).length, 1);
  assert.equal(f.context.photosFor("room-one").length, 0);
  assert.equal(f.elements["#text"].value, "");
});

test("an in-flight photo send stays in its room and preserves newer text", async () => {
  let finish: (value: unknown) => void = () => {};
  let announce: () => void = () => {};
  const started = new Promise<void>((resolve) => { announce = resolve; });
  const calls: { url: string; content: string }[] = [];
  const f = fixture(async (url, options) => {
    if (url.endsWith("/attachments")) return success;
    calls.push({ url, content: JSON.parse(String(options.body)).content });
    return new Promise((resolve) => { finish = resolve; announce(); });
  });
  f.elements["#text"].value = "Original caption";
  const sending = f.send();
  await started;
  f.context.sel = "room-two";
  f.elements["#text"].value = "New room draft";
  finish(success);
  await sending;
  assert.equal(calls[0].url, "/rooms/room-one/messages");
  assert.match(calls[0].content, /^Original caption\n\n\[image:/);
  assert.equal(f.elements["#text"].value, "New room draft");
});

test("photo rendering accepts only local canonical IDs and hides transport paths", () => {
  const f = fixture(async () => success);
  const marker = `[image: ${image.url} · ${image.path}]`;
  assert.equal(f.context.photoText(`Caption\n${marker}`), "Caption");
  assert.match(f.context.photoThumbnails(marker), /<img src="\/attachments\//);
  assert.equal(f.context.photoThumbnails("[image: https://evil.invalid/a.png · /tmp/a]"), "");
  assert.equal(f.context.photoThumbnails('[image: /attachments/" onerror="evil.png · /tmp/a]'), "");
});
