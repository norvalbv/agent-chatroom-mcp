#!/usr/bin/env node
/** Failing-first regression for the chair's relay of what it learns outside the room (swarm-073112-zcd7,
 * evidence/owner-interventions). In the live-money room swarm-185621-lc0a the owner sent ~37 messages to the chair's own
 * session while the room ran, 9 of them about the setup (19:02 "would it be better to buy a cheap VPS…", 20:00 "Let's get
 * a server close to the exchange then?"), and the chair had measured NordVPN and load 31 at 19:02; 0 room messages
 * mention VPN, load or geoblock, and the room's evidence (#235, 19:54) never met the owner's question. The skill a chair
 * follows must tell it to put such things on the room's board, and the benchmark must count those relays.
 * RED before the skills/swarm/SKILL.md line and the inputs/owner-* count in src/metrics/escalation-metrics.ts, GREEN after.
 * Run: node --import tsx scripts/chair-relay-regression.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { escalationMetrics } from "../src/metrics/escalation-metrics.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skill = readFileSync(resolve(root, "skills", "swarm", "SKILL.md"), "utf8");
assert.match(skill, /inputs\/owner-/, "SKILL.md must name the board key a chair relays the owner under");
assert.match(skill, /outside the room/i, "SKILL.md must say a chair carries what it learns outside the room into it");

const t = (m: number) => new Date(Date.UTC(2026, 9, 22, 19, m)).toISOString();
const r = escalationMetrics([
  { type: "room", room: "r", ts: t(0) },
  { type: "join", p: { name: "chair-claude", agent: "claude", role: "chair" } },
  { type: "join", p: { name: "s1", agent: "claude" } },
  { type: "board", key: "inputs/owner-1", by: "chair-claude", entry: { text: "OWNER (relayed): would a VPS near the exchange help?", updatedAt: t(2) } },
  { type: "board", key: "inputs/owner-1.ack", by: "s1", entry: { text: "ack", updatedAt: t(3) } },
  { type: "board", key: "inputs/owner-1", by: "chair-claude", entry: { text: "OWNER (relayed): edited", updatedAt: t(4) } },
]);
assert.equal(r.interventions.chairRelays, 1, "one inputs/owner-N entry is one relay, however often it is edited; an .ack is not one");
assert.equal(r.interventions.total, 1);

console.log("PASS chair-relay-regression: SKILL.md tells a chair to carry outside facts in under inputs/owner-N; the scorer counts each such entry once");
