// Browser check for the "questions for you" inbox (src/ui/inbox.ts, GET /questions).
// Usage: npm run build && PORT=<free port> node scripts/ui-inbox-regression.mjs
// Starts a private hub from dist/ on PORT with a scratch data dir, has two MCP agents ask the human in two rooms, then
// drives headless Chrome over CDP on PORT+1 with a fresh profile: tab-title and per-room counts, i opens the inbox,
// j moves, a quick-reply chip fills the box, Enter posts "@asker …" with reply_to that exact ask (and only it leaves
// /questions), the real "Open in room" button switches room and highlights the ask, Esc closes. Exits nonzero on any
// failed expectation or page error. Needs Google Chrome; set CHROME=<binary> elsewhere.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = Number(process.env.PORT ?? 7881);
const CDP = PORT + 1;
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const data = mkdtempSync(join(tmpdir(), "inbox-hub-"));
const prof = mkdtempSync(join(tmpdir(), "inbox-chrome-"));
const hub = spawn(process.execPath, ["dist/index.js"], { env: { ...process.env, PORT: String(PORT), CHATROOM_INSECURE_LOCAL: "1", CHATROOM_SPAWN_DRY: "1", CHATROOM_DATA_DIR: data }, stdio: "ignore" });
let chrome;
const done = (code, msg) => {
  console.log(msg);
  try { chrome?.kill(); } catch {}
  hub.kill();
  rmSync(data, { recursive: true, force: true });
  setTimeout(() => { try { rmSync(prof, { recursive: true, force: true, maxRetries: 5 }); } catch {} process.exit(code); }, 500);
};
process.on("uncaughtException", (e) => done(1, `INBOX FAIL\n${e?.stack ?? e}`));
process.on("unhandledRejection", (e) => done(1, `INBOX FAIL\n${e?.stack ?? e}`));
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; ; i++) { try { if ((await fetch(base + "/")).ok) break; } catch {} if (i > 40) done(1, "hub did not start"); await sleep(250); }

// two agents in run-a's main room, one in its sub-room; each asks the human something
const agent = async (room, name) => {
  const c = new Client({ name, version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  const call = async (tool, args) => JSON.parse(((await c.callTool({ name: tool, arguments: args })).content[0].text));
  const j = await call("join_room", { room, name, agent: "claude", topic: "inbox regression" });
  return { say: (content) => call("send_message", { room, participant_id: j.participant_id, content, force: true }), close: () => c.close() };
};
const MAIN = "swarm-170000-abcd-room", SUB = "swarm-170000-abcd-sub";
const a = await agent(MAIN, "alpha"), b = await agent(MAIN, "beta"), c = await agent(SUB, "gamma");
for (let i = 0; i < 12; i++) await (i % 2 ? a : b).say(`chatter ${i}`);
const qa = await a.say("@benji should the inbox be a modal or a rail section?");
await b.say("@alpha modal");
const qc = await c.say("@human may I delete the old fixtures?");
await c.say("@benji FYI the audit finished.");
for (const x of [a, b, c]) await x.close();

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
const key = async (k) => { for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: k, code: k, text: type === "keyDown" && k.length === 1 ? k : undefined, windowsVirtualKeyCode: k === "Enter" ? 13 : k === "Escape" ? 27 : k.toUpperCase().charCodeAt(0) }); };
await send("Runtime.enable");
await send("Page.enable");
await send("Page.navigate", { url: `${base}/ui?room=${MAIN}` });
await sleep(3000);

const got = {};
got.title = await ev("document.title");
got.badges = await ev("[...document.querySelectorAll('.room')].map(r => r.querySelectorAll('.qr').length + ':' + (r.querySelector('.qr') || {}).textContent).join(',')");
await key("i"); await sleep(300);
got.opens = await ev("!document.querySelector('#qpanel').hidden && document.querySelectorAll('.qitem').length");
got.newest_first = await ev("[...document.querySelectorAll('.qitem .qm b')].map(b => b.textContent).join(',')");
await key("j"); await sleep(150);
got.j_moves = await ev("document.querySelector('.qitem.sel .qm b').textContent");
got.chips = await ev(`[...document.querySelector('.qitem[data-qid="${qa.id}"]').querySelectorAll('.qchip')].map(c => c.textContent).slice(0, 2).join('|')`);
await ev(`document.querySelector('.qitem[data-qid="${qa.id}"] .qchip').click()`);
got.chip_fills = await ev("document.activeElement.dataset.qta + ':' + document.activeElement.value");
await send("Input.insertText", { text: ", thanks" });
await key("Enter"); await sleep(1500);
const msgs = await (await fetch(`${base}/rooms/${MAIN}/messages?since=0`)).json();
const reply = msgs.filter((m) => m.from.name === "benji").pop();
got.reply = reply ? `${reply.replyTo === qa.id}:${reply.content}` : null;
const left = await fetch(`${base}/questions?names=benji`).then((r) => r.json()).then((l) => l.filter((q) => q.kind === "question").map((q) => q.id)).catch(() => null);
got.only_that_settled = !!left && left.length === 1 && left[0] === qc.id;
got.title_after = await ev("document.title");
// the real "Open in room" button on the remaining ask: switches to the sub room and highlights it
got.open_btn_id = await ev(`(function () { var b = [...document.querySelectorAll('.qitem[data-qid="${qc.id}"] button')].find(function (x) { return x.textContent === 'Open in room'; }); b.click(); return b.dataset.qopen; })()`);
await sleep(2500);
got.jumped = await ev("new URLSearchParams(location.search).get('room') + '|' + document.querySelector('#qpanel').hidden + '|' + [...document.querySelectorAll('#log .hl')].map(x => x.dataset.seq).join(',')");
got.marker = await ev("document.querySelectorAll('#log .q4ub').length");
await key("i"); await sleep(200); await key("Escape"); await sleep(150);
got.esc_closes = await ev("document.querySelector('#qpanel').hidden");

const want = {
  title: "(2) Agent Chatroom",
  badges: "1:1?,1:1?",
  opens: 2,
  newest_first: "gamma,alpha",
  j_moves: "alpha",
  chips: "modal|rail section",
  chip_fills: `${qa.id}:modal`,
  reply: "true:@alpha modal, thanks",
  only_that_settled: true,
  title_after: "(1) Agent Chatroom",
  open_btn_id: qc.id,
  jumped: `${SUB}|true|${qc.seq}`,
  marker: 1,
  esc_closes: true,
};
const bad = Object.keys(want).filter((k) => got[k] !== want[k]).map((k) => `${k}: got ${JSON.stringify(got[k])}, want ${JSON.stringify(want[k])}`);
if (errs.length) bad.push(`page errors: ${errs.join(" | ")}`);
done(bad.length ? 1 : 0, bad.length ? `INBOX FAIL\n${bad.join("\n")}` : "INBOX OK");
