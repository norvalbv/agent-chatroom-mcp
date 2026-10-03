// Browser check for the dashboard command palette and pinned messages (src/ui/palette.ts).
// Usage: npm run build && PORT=<free port> node scripts/ui-palette-regression.mjs
// Starts a private hub from dist/ on PORT with a scratch data dir, seeds two rooms, drives headless Chrome over CDP
// (Cmd-K, fuzzy room jump, pin, decisions-only preset, jump to a filtered-out pin, #seq, reload persistence) and
// exits nonzero on any failed expectation or page error. Needs Google Chrome; set CHROME=<binary> elsewhere.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.PORT ?? 7861);
const CDP = PORT + 1;
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const data = mkdtempSync(join(tmpdir(), "palette-hub-"));
const prof = mkdtempSync(join(tmpdir(), "palette-chrome-"));
const hub = spawn(process.execPath, ["dist/index.js"], { env: { ...process.env, PORT: String(PORT), CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: data }, stdio: "ignore" });
let chrome;
const done = (code, msg) => {
  console.log(msg);
  try { chrome?.kill(); } catch {}
  hub.kill();
  rmSync(data, { recursive: true, force: true });
  setTimeout(() => { try { rmSync(prof, { recursive: true, force: true, maxRetries: 5 }); } catch {} process.exit(code); }, 500); // chrome is still writing its profile as it exits
};
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; ; i++) { try { if ((await fetch(base + "/")).ok) break; } catch {} if (i > 40) done(1, "hub did not start"); await sleep(250); }
const post = (room, content) => fetch(`${base}/rooms/${room}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "benji", content }) });
for (const t of ["hello 1 @all", "hello 2", "hello 3"]) await post("demo-room", t);
await post("other-room", "x");

chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${prof}`, "--window-size=1400,900", "about:blank"], { stdio: "ignore" });
let ws;
for (let i = 0; !ws; i++) { try { const p = (await (await fetch(`http://127.0.0.1:${CDP}/json`)).json()).find((x) => x.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} if (i > 60) done(1, "chrome did not start"); await sleep(250); }
if (ws.readyState !== 1) await new Promise((r) => { ws.onopen = r; });
let id = 0;
const pend = {}, errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
  if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pend[i]) { delete pend[i]; r({ result: { result: { value: `TIMEOUT ${method}` } } }); } }, 5000); });
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result.exceptionDetails ? `EXC ${r.result.exceptionDetails.exception?.description}` : r.result.result.value; };
const VK = { Enter: 13, Escape: 27 };
const key = async (k, modifiers = 0, code = k) => { for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: k, code, modifiers, windowsVirtualKeyCode: VK[k] ?? k.toUpperCase().charCodeAt(0) }); };
const type = (text) => send("Input.insertText", { text });
const META = 4, CTRL = 2;
await send("Runtime.enable");
await send("Page.enable");
await send("Page.navigate", { url: `${base}/ui?room=demo-room` });
await sleep(2500);

const got = {};
if (process.env.DEBUG) setInterval(() => console.error(JSON.stringify(got)), 3000).unref();
await key("k", META, "KeyK"); await sleep(200);
got.opens_focused = await ev(`document.querySelector('#pal')?.classList.contains('on') && document.activeElement.id`);
await type("other"); await sleep(200);
got.fuzzy_top = await ev(`document.querySelector('#pall li.on .l')?.textContent`);
await key("Enter"); await sleep(1000);
got.jumped = await ev(`document.querySelector('#head h2').textContent + '|' + document.querySelector('#pal').classList.contains('on')`);
await key("k", CTRL, "KeyK"); await sleep(150); await type("demo"); await sleep(150); await key("Enter"); await sleep(1200);
got.back = await ev(`document.querySelector('#head h2').textContent`);
got.pinned = await ev(`(document.querySelector('.pinb[data-pin="2"]').click(), document.querySelectorAll('#pinstrip .pin').length)`);
await key("k", META, "KeyK"); await sleep(150); await type("decisions"); await sleep(150); await key("Enter"); await sleep(400);
got.decisions_only = await ev(`document.querySelectorAll('#log .msg').length`);
got.goto_hidden_pin = await ev(`(document.querySelector('#pinstrip .pin').click(), document.querySelectorAll('#log .msg').length + '|' + document.querySelector('#log .hl')?.dataset.seq)`);
await key("k", META, "KeyK"); await sleep(150); await type("#3"); await sleep(150);
got.seq_item = await ev(`document.querySelector('#pall li.on .l')?.textContent`);
await key("Escape"); await sleep(100);
got.esc_closes = await ev(`!document.querySelector('#pal').classList.contains('on')`);
await ev("(location.reload(), 1)"); await sleep(2500);
got.pin_persists = await ev(`document.querySelectorAll('#pinstrip .pin').length`);

const want = { opens_focused: "palq", fuzzy_top: "other-room", jumped: "other-room|false", back: "demo-room", pinned: 1, decisions_only: 0, goto_hidden_pin: "3|2", seq_item: "Jump to message #3 in demo-room", esc_closes: true, pin_persists: 1 };
const bad = Object.keys(want).filter((k) => got[k] !== want[k]).map((k) => `${k}: got ${JSON.stringify(got[k])}, want ${JSON.stringify(want[k])}`);
if (errs.length) bad.push(`page errors: ${errs.join(" | ")}`);
done(bad.length ? 1 : 0, bad.length ? `PALETTE FAIL\n${bad.join("\n")}` : "PALETTE OK");
