/**
 * Whether a room's conclusion was right or used is recorded, by the owner, in the room's own log (telemetry gap G19:
 * "Nothing is recorded after the run"; swarm-102904-ouev concluded 1.6 minutes in and the owner overruled its answer,
 * which only prose says). POST /rooms/:room/verdict {verdict: adopted|rejected|partial, note, name} on the human route
 * (a seat's shell is refused, as on every human route) -> an owner_verdict event and one line in the room; a later
 * verdict replaces the earlier one in the runs table, and both stay in the log. Works on a concluded or closed room.
 * A served hub on its own port (never 7717), stopped by pid. Run: npx tsx scripts/owner-verdict-regression.ts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { parseRoomLog } from "../src/run-metrics.js";
import { renderRunsTable, runRow } from "../src/run-timeline.js";
import { ownHubPort } from "./lib/own-hub.js";
import { UI_HTML } from "../src/ui.js";

// the dashboard: its script still parses (a quote escaped once in the template literal is a syntax error in the page)
{
  const page = UI_HTML.slice(UI_HTML.indexOf("<script>") + 8, UI_HTML.lastIndexOf("</script>"));
  assert.doesNotThrow(() => new Function(page), "the dashboard's script parses");
}
// a concluded or closed room's header has a Verdict button that posts to the route
assert.match(UI_HTML, /r\.state === 'concluded' \|\| r\.state === 'closed'\) \? '<button class="btn hidephone" id="verdictroom"/);
assert.match(UI_HTML, /'\/verdict', \{ method: 'POST', headers: hdrs\(\), body: JSON\.stringify\(\{ name: myName\(\), verdict: v, note: note \}\)/);

const PORT = await ownHubPort(Number(process.env.PORT ?? 20_000 + Math.floor(Math.random() * 20_000)));
assert.notEqual(PORT, 7717, "never the live hub");
const HTTP = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), "owner-verdict-"));
const TOKEN = "owner-token-for-the-test";
const server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env: { ...process.env, PORT: String(PORT), CHATROOM_DATA_DIR: dir, CHATROOM_HUMAN_TOKEN: TOKEN, CHATROOM_SPAWN_DRY: "1", CHATROOM_NUDGE_MS: "0" }, stdio: "ignore" });
process.on("exit", () => { server.kill(); rmSync(dir, { recursive: true, force: true }); });
for (let i = 0; ; i++) {
  try { await fetch(`${HTTP}/`); break; } catch { if (i > 150) throw new Error("hub did not start"); await new Promise((r) => setTimeout(r, 200)); }
}
const ROOM = "verdict-room";
const seats = await Promise.all(["a", "b"].map(async (name) => {
  const c = new Client({ name, version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${HTTP}/mcp`)));
  const call = async (tool: string, args: Record<string, unknown>) => { const r: any = await c.callTool({ name: tool, arguments: { room: ROOM, ...args } }); return JSON.parse(r.content[0].text); };
  await call("join_room", { name, agent: "test", require_challenge: false, expected_participants: 0 });
  return call;
}));
const pr = await seats[0]("propose", { text: "Use the August slice as the holdout for every rule." });
await seats[1]("vote", { proposal_id: pr.id, vote: "agree", quote: "the August slice as the holdout" });
const post = async (body: unknown, token?: string) => { const r = await fetch(`${HTTP}/rooms/${ROOM}/verdict`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-chatroom-token": token } : {}) }, body: JSON.stringify(body) }); return { status: r.status, text: await r.text() }; };

assert.equal((await post({ verdict: "rejected", note: "x" })).status, 401, "the human route needs the owner's token here");
assert.equal((await post({ verdict: "great", note: "x" }, TOKEN)).status, 400, "verdict is a closed set");
const v1 = await post({ verdict: "rejected", note: "concluded 1.6 min in; the holdout leaks the June regime", name: "benji" }, TOKEN);
assert.equal(v1.status, 200, v1.text);
const v2 = await post({ verdict: "partial", note: "on reflection the holdout is fine, the rule set is not", name: "benji" }, TOKEN);
assert.equal(v2.status, 200);
const events = parseRoomLog(readFileSync(join(dir, `${ROOM}.jsonl`), "utf8"));
const verdicts = events.filter((e) => e.type === "owner_verdict");
assert.deepEqual(verdicts.map((e) => [e.verdict, e.by, e.proposal_id]), [["rejected", "benji", pr.id], ["partial", "benji", pr.id]], "both kept, each naming the conclusion it judges");
const line = events.filter((e) => e.type === "message" && e.msg.kind === "system").map((e) => String(e.msg.content)).filter((c) => /verdict/i.test(c));
assert.equal(line.length, 2);
assert.match(line[0], /benji's verdict on this room's conclusion: rejected \(concluded 1\.6 min in/);
const row = runRow(events);
assert.equal(row.ownerVerdict, "partial", "the latest stands in the runs table");
assert.match(renderRunsTable([row]), /\| partial \|/);
assert.equal((await fetch(`${HTTP}/rooms/no-such-room/verdict`, { method: "POST", headers: { "content-type": "application/json", "x-chatroom-token": TOKEN }, body: JSON.stringify({ verdict: "adopted" }) })).status, 400);
server.kill();
console.log("owner-verdict-regression: ok");
process.exit(0);
