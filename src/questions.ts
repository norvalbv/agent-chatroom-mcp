/**
 * Asks addressed TO the human, the reverse of Hub.unansweredHuman (which tracks asks FROM a human).
 *
 * A human running eight agents could not find the questions meant for them in 200+ messages. This lists, across
 * rooms, every agent chat message addressed to a human that no human has answered yet, so the dashboard can show
 * an inbox with a reply box.
 *
 * Addressed to a human: it @-names a human (anyone who joined the room as a human, the room's chair, CHATROOM_HUMAN_NAMES,
 * "human"/"owner", or a name the dashboard passes), or it replies (reply_to) to a human's message.
 * It is a "question" when it contains a "?" outside code; otherwise a "mention" (an FYI the inbox shows lower down).
 * A plain reply to a human's message with no "?" is that human's answer, not an ask, so it is left out.
 *
 * Answered: only a later human chat message that replies to it (reply_to). A later "@asker ..." does not count: it may be
 * about something else, and it would settle every earlier ask from that agent at once. Viewing it does not answer it
 * either; the dashboard's Dismiss hides one locally.
 */
import type { Hub, Message, Room } from "./hub.js";

export interface HumanQuestion {
  id: string;
  room: string;
  seq: number;
  ts: string;
  from: string;
  agent: string;
  kind: "question" | "mention";
  text: string;
  /** the message it replies to, when it is threaded under one */
  reply_to: { seq: number; from: string; text: string } | null;
  room_state: string;
}

const DEFAULT_NAMES = ["human", "owner"];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every name that means "the human" in this room. */
export function humanNames(room: Room, extra: string[] = []): string[] {
  const env = (process.env.CHATROOM_HUMAN_NAMES ?? "").split(",");
  const names = new Set<string>();
  for (const n of [...DEFAULT_NAMES, ...env, ...extra]) if (n.trim()) names.add(n.trim().toLowerCase());
  if (room.chair) names.add(room.chair.toLowerCase());
  for (const p of room.participants.values()) if (p.agent === "human") names.add(p.name.toLowerCase());
  return [...names];
}

/** "?" in prose, ignoring fenced and inline code and URLs (a query string is not a question). */
export function asksSomething(text: string): boolean {
  const prose = text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ").replace(/\bhttps?:\/\/\S+/g, " ");
  return /\?/.test(prose);
}

export function questionsIn(room: Room, extraNames: string[] = []): HumanQuestion[] {
  const names = humanNames(room, extraNames);
  if (!names.length) return [];
  const at = new RegExp(`(^|[^\\w@])@(${names.map(esc).join("|")})(?![\\w-])`, "i");
  const byId = new Map<string, Message>();
  for (const m of room.messages) byId.set(m.id, m);
  const humanChat = room.messages.filter((m) => m.kind === "chat" && m.from.agent === "human");
  const out: HumanQuestion[] = [];
  for (const m of room.messages) {
    if (m.kind !== "chat" || m.from.agent === "human" || m.tag === "opening") continue;
    const parent = m.replyTo ? byId.get(m.replyTo) : undefined;
    const repliesToHuman = parent?.from.agent === "human";
    const named = at.test(m.content);
    if (!named && !repliesToHuman) continue;
    const asks = asksSomething(m.content);
    if (repliesToHuman && !asks) continue; // the answer to the human, not an ask of them
    if (isAnswered(m, humanChat)) continue;
    out.push({
      id: m.id,
      room: room.name,
      seq: m.seq,
      ts: m.ts,
      from: m.from.name,
      agent: m.from.agent,
      kind: asks ? "question" : "mention",
      text: m.content,
      reply_to: parent ? { seq: parent.seq, from: parent.from.name, text: parent.content.slice(0, 200) } : null,
      room_state: room.state,
    });
  }
  return out;
}

function isAnswered(q: Message, humanChat: Message[]): boolean {
  return humanChat.some((h) => h.seq > q.seq && h.replyTo === q.id);
}

/** All rooms' open asks to the human, newest first. Archived rooms are left out unless asked for. */
export function humanQuestions(hub: Hub, opts: { names?: string[]; includeArchived?: boolean } = {}): HumanQuestion[] {
  const out: HumanQuestion[] = [];
  for (const room of hub.rooms.values()) {
    if (room.archived && !opts.includeArchived) continue;
    out.push(...questionsIn(room, opts.names));
  }
  return out.sort((a, b) => b.ts.localeCompare(a.ts));
}
