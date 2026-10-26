/**
 * Replay recorded room logs through src/hub/asks/hands.ts (decision/hands-for-unowned-ideas): where would the hands ask have
 * fired, and what became of each such idea in the run that had no ask. The "before" side of the benchmark: the same
 * checkHands the hub runs, fed each log's board, joins and leaves in order and swept once a simulated minute.
 *
 * npx tsx scripts/hands-replay.ts <room.jsonl | dir>... [--json]
 * Streams each file (logs reach 20 MB); keeps only board, seats and the asks it would have posted.
 */
import { createReadStream, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Hub } from "../src/hub.js";
import { checkHands } from "../src/hub/asks/hands.js";
import type { BoardEntry, Message, Participant, Room } from "../src/hub/types.js";

type Ev = Record<string, any>;
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const files = args.filter((a) => a !== "--json").flatMap((a) => statSync(a).isDirectory()
  ? readdirSync(a).filter((f) => f.endsWith(".jsonl")).map((f) => join(a, f)) : [a]);

interface Sim { room: Room; events: Ev[]; tick: number; ideas: Set<string> }
const tsOf = (ev: Ev): string | undefined => ev.ts ?? ev.entry?.updatedAt ?? ev.msg?.ts ?? ev.createdAt ?? ev.p?.lastActiveAt;

function fakeHub(sim: () => Sim, clock: () => number): Hub {
  return {
    activeParticipants: (room: Room) => [...room.participants.values()].filter((p) => p.active),
    shown: (_room: Room, p: Participant) => p.name,
    post: (room: Room, kind: string, _from: unknown, content: string, extra: Partial<Message> = {}) => {
      const m = { seq: room.messages.length + 1, id: `sim-${room.messages.length + 1}`, room: room.name, kind, from: { id: "system", name: "system", agent: "hub" }, content, ts: new Date(clock()).toISOString(), ...extra } as Message;
      room.messages.push(m);
      return m;
    },
    persist: (ev: Ev) => { sim().events.push(ev); },
  } as unknown as Hub;
}

async function replay(file: string): Promise<Map<string, Sim>> {
  const sims = new Map<string, Sim>();
  let current: Sim | undefined;
  let now = 0;
  const hub = fakeHub(() => current!, () => now);
  const simOf = (name: string): Sim => {
    let s = sims.get(name);
    if (!s) {
      const room = { name, state: "open", board: new Map<string, BoardEntry>(), participants: new Map<string, Participant>(), messages: [] as Message[] } as unknown as Room;
      s = { room, events: [], tick: 0, ideas: new Set() };
      sims.set(name, s);
    }
    return s;
  };
  const advance = (s: Sim, to: number) => {
    if (!s.tick) { s.tick = to; return; }
    current = s;
    for (let t = s.tick + 60_000; t <= to; t += 60_000) { now = t; checkHands(hub, s.room, t); s.tick = t; }
  };
  const lines = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    let ev: Ev;
    try { ev = JSON.parse(line); } catch { continue; }
    const name = ev.room ?? ev.msg?.room ?? ev.proposal?.room;
    if (typeof name !== "string") continue;
    const s = simOf(name);
    const at = Date.parse(tsOf(ev) ?? "");
    if (Number.isFinite(at)) advance(s, at);
    const r = s.room;
    switch (ev.type) {
      case "room": if (ev.opts?.chair) r.chair = ev.opts.chair; break;
      case "chair_named": r.chair = ev.name; break;
      case "join": case "leave": {
        const p = { ...ev.p, active: ev.type === "join" } as Participant;
        if (p.role === "chair" && !r.chair) r.chair = p.name;
        r.participants.set(p.id, p);
        break;
      }
      case "board":
        if (ev.entry) r.board.set(ev.key, ev.entry); else r.board.delete(ev.key);
        if (String(ev.key).startsWith("idea/") && ev.entry?.text?.trim()) s.ideas.add(ev.key);
        break;
      case "state": r.state = ev.state; break;
    }
  }
  return sims;
}

const rows: Ev[] = [];
let rooms = 0, ideas = 0;
for (const f of files) {
  for (const [name, s] of await replay(f)) {
    rooms++; ideas += s.ideas.size;
    const asked = s.events.filter((e) => e.type === "hands_asked");
    for (const a of asked) {
      const done = s.events.find((e) => e.type === "hands_resolved" && e.key === a.key);
      rows.push({ room: name, key: a.key, author: a.author, asked: a.asked, workers: a.workers, age_min: a.idea_age_min, at: a.ts, how: done?.how ?? "never", after_min: done?.after_min });
    }
    for (const u of s.events.filter((e) => e.type === "hands_unasked")) rows.push({ room: name, key: u.key, author: u.author, asked: null, workers: u.workers, age_min: u.idea_age_min, at: u.ts, how: "nobody to ask" });
  }
}
if (asJson) { console.log(JSON.stringify({ rooms, ideas, rows }, null, 1)); process.exit(0); }
const count = (how: string) => rows.filter((r) => r.how === how).length;
const within = (m: number) => rows.filter((r) => r.after_min !== undefined && r.after_min <= m).length;
console.log(`${files.length} files, ${rooms} rooms, ${ideas} idea/* entries; the hands ask would have fired ${rows.filter((r) => r.asked).length} times in ${new Set(rows.filter((r) => r.asked).map((r) => r.room)).size} rooms` +
  ` (+${count("nobody to ask")} with nobody to ask).`);
console.log(`Without the ask, those ideas ended: recruited ${count("recruited")}, claimed ${count("claimed")}, dropped ${count("dropped")}, built ${count("built")}, never ${count("never")}; resolved within 20 min of the would-be ask: ${within(20)}.`);
for (const r of rows) console.log(`  ${r.room} ${r.key} by ${r.author} -> ${r.asked ?? "-"} (${r.workers} workers busy, idea ${r.age_min} min old, ${r.at}): ${r.how}${r.after_min !== undefined ? ` after ${r.after_min} min` : ""}`);
