/** Asks addressed to the human (src/questions.ts): an agent's @benji/@human question is listed across rooms until a
 * human replies to it with reply_to; a later unrelated human message, an "@asker" without reply_to, or an agent's
 * answer to the human do not list or settle anything. Over HTTP: GET /questions, POST /rooms/:room/messages with
 * reply_to. Run: PORT=<free port> npx tsx scripts/questions-regression.ts */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";
import { Script } from "node:vm";
import { asksSomething, humanQuestions, questionsIn } from "../src/questions.js";
import { UI_HTML } from "../src/ui.js";

// ---- unit: the hub's own log ----
const hub = new Hub({ dataDir: mkdtempSync(join(tmpdir(), "questions-")) });
const a = hub.join("r1", "opus-a", "claude").participant.id;
const b = hub.join("r1", "opus-b", "claude").participant.id;
const say = (room: string, pid: string, text: string, replyTo?: string) => hub.send(room, pid, text, replyTo, true);

const q1 = say("r1", a, "@benji should the inbox live in the rail or a modal?");
const fyi = say("r1", b, "@benji FYI: build is green.");
say("r1", a, "@opus-b can you review? (not for the human)");
say("r1", b, "Using `fetch('/x?y=1')` and https://a.b/?q=1 here, @human.");
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

let qs = questionsIn(hub.getRoom("r1"), ["benji"]);
assert.deepEqual(ids(qs.filter((q) => q.kind === "question")), [q1.id], "an @benji message with a ? is a question; ? inside code or a URL is not");
assert.ok(qs.some((q) => q.id === fyi.id && q.kind === "mention"), "@benji without a ? is a mention");
assert.equal(questionsIn(hub.getRoom("r1"), []).filter((q) => q.kind === "question").length, 0, "benji is only a human name once passed or joined");

// a human joins and talks without reply_to: nothing settles, and an @asker is not a reply
const h = hub.join("r1", "benji", "human").participant.id;
say("r1", h, "@all carry on");
say("r1", h, "@opus-a hmm, also check the tests");
qs = questionsIn(hub.getRoom("r1"));
assert.ok(ids(qs).includes(q1.id), "neither a later message nor @asker settles it; a joined human's name counts without passing it");

// the agent answering the human is not a question; a follow-up with a ? that replies to the human is
const hq = say("r1", h, "@opus-b what's left?");
say("r1", b, "@benji only the CSS.", hq.id);
const follow = say("r1", b, "@benji the CSS, unless you want dark mode first?", hq.id);
qs = questionsIn(hub.getRoom("r1"));
assert.deepEqual(ids(qs.filter((q) => q.from === "opus-b" && q.kind === "question")), [follow.id], "an answer is not an ask; a reply with a ? is");

// exact reply_to settles exactly that ask
say("r1", h, "@opus-a the modal", q1.id);
qs = questionsIn(hub.getRoom("r1"));
assert.ok(!ids(qs).includes(q1.id), "reply_to settles it");
assert.ok(ids(qs).includes(follow.id), "…and only it");

// across rooms, newest first, archived rooms left out unless asked
const c = hub.join("r2", "codex-c", "codex").participant.id;
const q2 = say("r2", c, "@owner ship it?");
const all = humanQuestions(hub, { names: ["benji"] });
assert.ok(ids(all).includes(q2.id) && ids(all).includes(follow.id), "across rooms");
assert.ok(all.every((q, i) => i === 0 || all[i - 1].ts >= q.ts), "newest first");
hub.leave("r2", c);
hub.getRoom("r2").createdAt = new Date(0).toISOString();
hub.archiveRoom("r2", "benji");
assert.ok(!ids(humanQuestions(hub)).includes(q2.id), "archived rooms are left out");
assert.ok(ids(humanQuestions(hub, { includeArchived: true })).includes(q2.id));
assert.equal(asksSomething("see ```\nwhy?\n``` and `a?b`"), false);

// the dashboard carries the inbox and its inline script still parses with the inbox spliced in
assert.ok(UI_HTML.includes('id="qpanel"') && UI_HTML.includes("fetchQuestions"), "inbox is in the dashboard");
new Script(UI_HTML.split("<script>")[1].split("</script>")[0]);
// quick-reply chips: "A or B?" offers A and B; anything else Yes/No; never a long clause
{
  const src = UI_HTML.split("<script>")[1].split("</script>")[0];
  const grab = (name: string) => {
    const i = src.indexOf(`var ${name} = function`);
    for (let k = src.indexOf("{", i), d = 0; k < src.length; k++) {
      if (src[k] === "{") d++;
      if (src[k] === "}" && --d === 0) return src.slice(i, k + 2);
    }
    throw new Error(name);
  };
  const choices = new Function(`${grab("qAskLine")}\n${grab("qChoices")}\nreturn qChoices;`)() as (q: { text: string }) => string[];
  assert.deepEqual(choices({ text: "@benji should the inbox be a modal or a rail section? I lean modal." }).slice(0, 2), ["modal", "rail section"]);
  assert.deepEqual(choices({ text: "@benji Postgres or SQLite?" }).slice(0, 2), ["Postgres", "SQLite"]);
  assert.deepEqual(choices({ text: "@human can I delete the old fixtures in data/, or keep them for the report?" }).slice(0, 2), ["Yes", "No"]);
  assert.deepEqual(choices({ text: "@benji is the build OK?" }).slice(0, 2), ["Yes", "No"]);
}
// every inbox button carries the ask's id (a stray quote once left "Open in room" with data-qopen="")
{
  const src = UI_HTML.split("<script>")[1].split("</script>")[0];
  const fn = (name: string) => {
    const i = src.indexOf(`function ${name}(`);
    for (let k = src.indexOf("{", i), d = 0; k < src.length; k++) {
      if (src[k] === "{") d++;
      if (src[k] === "}" && --d === 0) return src.slice(i, k + 1);
    }
    throw new Error(name);
  };
  const v = (name: string) => {
    const i = src.indexOf(`var ${name} = function`);
    for (let k = src.indexOf("{", i), d = 0; k < src.length; k++) {
      if (src[k] === "{") d++;
      if (src[k] === "}" && --d === 0) return src.slice(i, k + 1) + ";";
    }
    throw new Error(name);
  };
  const stubs = "var esc = function (s) { return String(s).replace(/[&<>\"]/g, ''); }; var av = function () { return ''; }; var rel = function () { return ''; }; var withMentions = function (h) { return h; }; var expanded = {}, qDrafts = {}, qSelId = null; var runOf = function () { return null; };";
  const qItem = new Function(`${stubs}\n${v("qShort")}\n${v("qAskLine")}\n${v("qChoices")}\n${fn("qItem")}\nreturn qItem;`)() as (q: object) => string;
  const html = qItem({ id: "m_x1", room: "r", seq: 3, ts: "", from: "a", agent: "claude", kind: "question", text: "@benji ok?", reply_to: null, room_state: "open" });
  for (const attr of ["data-qopen", "data-qdis", "data-qsend", "data-qta", "data-qchip"]) assert.ok(html.includes(`${attr}="m_x1"`), `${attr} carries the ask id`);
  assert.ok(!/data-[\w-]+=""/.test(html), "no empty data attribute");
}

// ---- HTTP: the dashboard's calls against the built hub ----
const PORT = Number(process.env.PORT ?? 7861);
const HTTP = `http://127.0.0.1:${PORT}`;
const data = mkdtempSync(join(tmpdir(), "questions-http-"));
const server = spawn("node", ["dist/index.js"], { env: { ...process.env, PORT: String(PORT), CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: data, CHATROOM_SPAWN_DRY: "1" }, stdio: ["ignore", "ignore", "inherit"] });
process.on("exit", () => server.kill());
for (let i = 0; i < 50; i++) {
  try { await fetch(`${HTTP}/`); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
}
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
const agent = new Client({ name: "t", version: "0" });
await agent.connect(new StreamableHTTPClientTransport(new URL(`${HTTP}/mcp`)));
const call = async (tool: string, args: Record<string, unknown>) => {
  const res = (await agent.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  if (res.isError) throw new Error(res.content[0]?.text);
  return JSON.parse(res.content[0].text);
};
const j = await call("join_room", { room: "web", name: "opus-x", agent: "claude", topic: "t" });
const sent = await call("send_message", { room: "web", participant_id: j.participant_id, content: "@benji which port should I use?" });
const get = async () => (await (await fetch(`${HTTP}/questions?names=benji`)).json()) as { id: string; room: string; from: string; kind: string }[];
let list = await get();
assert.equal(list.length, 1); assert.equal(list[0].id, sent.id); assert.equal(list[0].from, "opus-x"); assert.equal(list[0].kind, "question");
assert.equal((await (await fetch(`${HTTP}/questions`)).json()).length, 0, "without names= benji is not a human name here yet");
const post = await fetch(`${HTTP}/rooms/web/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "benji", content: "@opus-x 7900", reply_to: sent.id }) });
assert.equal(post.status, 200);
assert.equal(((await post.json()) as { replyTo?: string }).replyTo, sent.id, "the human's reply is threaded to the ask");
list = await get();
assert.equal(list.length, 0, "answered over HTTP");
await agent.close();
server.kill();
console.log("QUESTIONS OK");
process.exit(0);
