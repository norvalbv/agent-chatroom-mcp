/**
 * Probe, not a test: what a running hub does today towards isolated opposing groups with digests between them.
 * Run against a hub you started: PORT=7910 npx tsx scripts/ns-shape-probe.ts
 * Prints one line per question (OK = the hub did it, REFUSED = the hub said no, with its words).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = Number(process.env.PORT ?? 7910);
const HTTP = `http://127.0.0.1:${PORT}`;
const TAG = process.env.TAG ?? String(Date.now() % 100000);
const LOBBY = `ns-${TAG}-lobby`, BUILD = `ns-${TAG}-build`, BREAK = `ns-${TAG}-break`, SUB = `ns-${TAG}-sub`;

async function connect(name: string) {
  const client = new Client({ name, version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${HTTP}/mcp`)));
  const call = async (tool: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    const text = res.content[0]?.text ?? "";
    if (res.isError) throw new Error(text);
    try { return JSON.parse(text); } catch { return text; }
  };
  return { name, call };
}
const short = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v)).replace(/\s+/g, " ").slice(0, 260);
async function ask(q: string, f: () => Promise<unknown>) {
  try { console.log(`OK      ${q}\n          -> ${short(await f())}`); }
  catch (e) { console.log(`REFUSED ${q}\n          -> ${short((e as Error).message)}`); }
}

const chair = await connect("chair"), b1 = await connect("build-1"), b2 = await connect("build-2"), k1 = await connect("break-1"), k2 = await connect("break-2");
const loose = { require_challenge: false, require_verification: false, quorum: "majority" };

console.log("== groups as breakouts of a lobby");
await ask("chair creates the lobby", async () => (await chair.call("join_room", { room: LOBBY, name: "chair", agent: "claude", topic: "lobby", ...loose })).you_are);
await ask("chair opens BUILD as a breakout with its own topic", async () => (await chair.call("join_room", { room: BUILD, name: "chair", agent: "claude", parent: LOBBY, topic: "BUILD the lead", ...loose })).room.topic);
await ask("chair opens BREAK as a breakout with the opposing topic", async () => (await chair.call("join_room", { room: BREAK, name: "chair", agent: "claude", parent: LOBBY, topic: "BREAK the lead", ...loose })).room.topic);
await ask("a seat that is NOT in the lobby opens a breakout of it", async () => (await b1.call("join_room", { room: `ns-${TAG}-rogue`, name: "build-1", agent: "claude", parent: LOBBY })).you_are);
await ask("build-1 joins BUILD only (never the lobby)", async () => (await b1.call("join_room", { room: BUILD, name: "build-1", agent: "claude" })).room.topic);
await ask("build-2 joins BUILD only", async () => (await b2.call("join_room", { room: BUILD, name: "build-2", agent: "claude" })).you_are);
await ask("break-1 joins BREAK only", async () => (await k1.call("join_room", { room: BREAK, name: "break-1", agent: "claude" })).room.topic);
await ask("break-2 joins BREAK only", async () => (await k2.call("join_room", { room: BREAK, name: "break-2", agent: "claude" })).you_are);
await ask("chair leaves BUILD and BREAK (so it is not in either electorate)", async () => [await chair.call("leave_room", { room: BUILD, reason: "opened the room only; not a member of this group" }), await chair.call("leave_room", { room: BREAK, reason: "opened the room only; not a member of this group" })].length);

console.log("== isolation: what can a BREAK seat learn about BUILD without joining it");
await b1.call("board_set", { room: BUILD, key: "findings/build-1", text: "SECRET-BUILD-FINDING: reward model v2" });
await b1.call("send_message", { room: BUILD, content: "SECRET-BUILD-CHAT", force: true });
await ask("break-1 board_get on BUILD (not a member)", () => k1.call("board_get", { room: BUILD, key: "findings/build-1" }));
await ask("break-1 read_messages on BUILD (not a member)", () => k1.call("read_messages", { room: BUILD, since_seq: 0 }));
await ask("break-1 room_status on BUILD (not a member)", async () => { const s = await k1.call("room_status", { room: BUILD }); return { topic: s.topic, board: Object.keys(s.board ?? {}), participants: (s.participants ?? []).map((p: { name: string }) => p.name) }; });
await ask("break-1 list_rooms shows BUILD", async () => (await k1.call("list_rooms")).rooms?.map?.((r: { name: string }) => r.name) ?? (await k1.call("list_rooms")));
await ask("GET /rooms/BUILD over plain HTTP (no MCP seat) returns the log", async () => { const r = await fetch(`${HTTP}/rooms/${BUILD}`); const t = (await r.text()) + (await (await fetch(`${HTTP}/rooms/${BUILD}/messages`)).text()); return `${r.status} contains SECRET-BUILD-CHAT=${t.includes("SECRET-BUILD-CHAT")} contains SECRET-BUILD-FINDING=${t.includes("SECRET-BUILD-FINDING")}`; });
await ask("break-1 simply joins BUILD", async () => (await k1.call("join_room", { room: BUILD, name: "break-1", agent: "claude" })).you_are);
await ask("break-1 (now a member) reads BUILD's board", () => k1.call("board_get", { room: BUILD, key: "findings/build-1" }));
await k1.call("leave_room", { room: BUILD, reason: "probe: leaving again after reading the board" }).catch(() => k1.call("leave_room", { room: BUILD, reason: "probe: leaving again after reading the board" }));

console.log("== digests between groups");
await ask("chair post_to_room lobby -> BUILD (digest)", () => chair.call("post_to_room", { from_room: LOBBY, to_room: BUILD, key: "digest-1", text: "DIGEST 1 from BREAK: fills on trade-through are adverse." }));
await ask("chair post_to_room lobby -> BREAK with ack_required", () => chair.call("post_to_room", { from_room: LOBBY, to_room: BREAK, key: "digest-1", text: "DIGEST 1 from BUILD: model v2 pays $3/day at $750.", ack_required: true }));
await ask("build-1's next wait carries the digest notice", async () => (await b1.call("wait_for_messages", { room: BUILD, timeout_ms: 0 })).messages?.filter((m: string) => m.includes("digest-1")));
await ask("BREAK proposes while the ack-required digest is unacknowledged", () => k1.call("propose", { room: BREAK, text: "The lead is broken: adverse fills eat the reward." }));
await ask("break-1 acknowledges the digest", () => k1.call("board_set", { room: BREAK, key: `inbox/${LOBBY}/digest-1.ack`, text: "ack" }));
await ask("BUILD seat posts straight into BREAK (group to group, no chair)", () => b1.call("post_to_room", { from_room: BUILD, to_room: BREAK, key: "direct", text: "hello from build" }));
await ask("chair post_to_room with a 9000-char digest", () => chair.call("post_to_room", { from_room: LOBBY, to_room: BUILD, key: "big", text: "x".repeat(9000) }));

console.log("== a group's conclusion reaches the lobby, and only the lobby");
let breakProp = "";
await ask("break-1 proposes in BREAK", async () => (breakProp = (await k1.call("propose", { room: BREAK, text: "The lead is broken: adverse fills eat the reward." })).id ?? "?"));
await ask("break-2 agrees", async () => (await k2.call("vote", { room: BREAK, proposal_id: breakProp, vote: "agree", quote: "adverse fills eat the reward" })).room_state ?? "voted");
await ask("lobby board now has inbox/BREAK/conclusion", () => chair.call("board_get", { room: LOBBY, key: `inbox/${BREAK}/conclusion` }));
await ask("BUILD's board has BREAK's conclusion", async () => Object.keys((await b1.call("board_get", { room: BUILD })).entries ?? (await b1.call("board_get", { room: BUILD }))));
await ask("chair post_to_room into the concluded BREAK (a follow-up prompt for round 2)", () => chair.call("post_to_room", { from_room: LOBBY, to_room: BREAK, key: "round-2", text: "Follow-up: now attack model v3." }));
await ask("break-1 sends a message in the concluded BREAK", () => k1.call("send_message", { room: BREAK, content: "round 2 start", force: true }));
await ask("break-1 proposes again in the concluded BREAK", () => k1.call("propose", { room: BREAK, text: "Round 2: v3 also breaks." }));
await ask("lobby room_status lists breakouts and their state", async () => (await chair.call("room_status", { room: LOBBY })).breakouts);

console.log("== seeding a group with solved work before it starts");
const SEED = `ns-${TAG}-seeded`;
await ask("chair opens SEEDED breakout and posts seed notes before any seat joins", async () => { await chair.call("join_room", { room: SEED, name: "chair", agent: "claude", parent: LOBBY, topic: "seeded group", ...loose }); return chair.call("post_to_room", { from_room: LOBBY, to_room: SEED, key: "solved", text: "SOLVED: holding reward is 3.25%/yr; dead list: copying wallets, momentum." }); });
await ask("a seat joining SEEDED later sees the seed in its join result", async () => { const j = await b2.call("join_room", { room: SEED, name: "build-2", agent: "claude" }); return { board: Object.keys(j.room.board ?? {}), recent: (j.recent_messages ?? []).filter((m: string) => m.includes("solved")) }; });

console.log("== moving a seat from one group to another");
await ask("build-2 leaves BUILD (reason given)", () => b2.call("leave_room", { room: BUILD, reason: "moved to SEEDED by the chair" }));
await ask("build-2 leaves BUILD (second call)", () => b2.call("leave_room", { room: BUILD, reason: "moved to SEEDED by the chair" }));
await ask("BUILD now has these active seats", async () => (await b1.call("room_status", { room: BUILD })).participants.filter((p: { active: boolean }) => p.active).map((p: { name: string }) => p.name));
await ask("build-1 alone proposes in BUILD (a room of one)", () => b1.call("propose", { room: BUILD, text: "Model v2 pays $3/day at $750 bankroll." }));

console.log("== request_agent(new_room): a recruited sub-team");
await ask("chair request_agent new_room=SUB (dry spawn)", () => chair.call("request_agent", { room: LOBBY, brief: "Try to break the liquidity-rewards lead; done when the room adopts a conclusion.", new_room: SUB, room_topic: "sub team", agent: "claude", model: "claude-opus-5-5", count: 2 }));
await ask("SUB room's parent field", async () => { const all = await chair.call("list_rooms"); const r = (all.rooms ?? all).find((x: { name: string }) => x.name.endsWith(SUB)); return { name: r?.name, parent: r?.parent ?? null }; });
await ask("lobby room_status breakouts includes SUB", async () => ((await chair.call("room_status", { room: LOBBY })).breakouts ?? []).map((b: { room: string }) => b.room));
process.exit(0);
