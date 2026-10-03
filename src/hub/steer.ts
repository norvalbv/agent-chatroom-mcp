/**
 * Steering: an addressed ask reaches a seat that is busy mid-turn, without it calling wait_for_messages or read_messages
 * (swarm-181144-uxtr, problem 3). One contract for every seat kind:
 * - peek (POST /heartbeat, /rooms/:room/heartbeat): the asks this seat has not been delivered yet; nothing is consumed,
 *   so a hook that fails or a seat that loses its context never swallows an ask;
 * - ack (POST /steer/ack, /rooms/:room/steer/ack) once the consumer put them in its model's context (claude hook
 *   additionalContext, codex turn/steer, the OpenRouter seat's next step): delivered, and the next wait sends a stub;
 * - carry: any other hub tool result brings pending asks along and counts as their delivery (the universal fallback).
 */
import type { Hub } from "../hub.js";
import type { Message, Participant, Room } from "./types.js";

/** One addressed ask as a consumer injects it mid-turn. */
export interface SteerItem { room: string; id: string; seq: number; from: string; text: string }

/**
 * Asks addressed to this seat and not delivered yet by any path (wait, read, carry, an earlier ack): the human message it
 * is the nominated responder for, then authored @-mentions and replies to it. Hub notices are news, not asks.
 */
export function steerPending(hub: Hub, room: Room, p: Participant): Message[] {
  if (!p.active || p.agent === "human" || room.state === "concluded" || room.state === "closed") return [];
  const held = new Set(p.withheld ?? []);
  const steered = new Set(p.steered ?? []);
  const unseen = (m: Message) => (m.seq > p.lastSeenSeq || held.has(m.seq)) && !steered.has(m.id);
  const focus = hub.attentionFocus(room, p);
  const asks = [...(focus?.from.agent === "human" ? [focus] : []), ...hub.addressedBy(room, p).filter((m) => m.from.id !== "system")];
  return [...new Map(asks.filter(unseen).map((m) => [m.id, m])).values()].sort((a, b) => a.seq - b.seq);
}

/** One line per ask, the whole body (chat is already capped at the source): who, where, and the reply_to that settles it. */
export function steerLine(hub: Hub, room: Room, m: Message): SteerItem {
  return { room: room.name, id: m.id, seq: m.seq, from: hub.shown(room, m.from), text: `${hub.fmt(room, m)} (reply: send_message room="${room.name}" reply_to="${m.id}")` };
}

/**
 * The consumer injected these asks: delivered (settleRead up to them: earlier unseen chatter is kept as withheld and still
 * delivered by the next wait, in order) and never peeked again. Debt is unchanged: an ask stays owed until a reply or pass.
 */
export function steerAck(hub: Hub, room: Room, p: Participant, ids: string[]): number {
  const want = new Set(ids);
  const msgs = steerPending(hub, room, p).filter((m) => want.has(m.id));
  if (!msgs.length) return 0;
  hub.settleRead(room, p, p.lastSeenSeq, msgs, Math.max(p.lastSeenSeq, ...msgs.map((m) => m.seq)));
  p.steered = [...(p.steered ?? []), ...msgs.map((m) => m.id)].slice(-100);
  return msgs.length;
}

/** A message as wait_for_messages delivers it: an ask the seat was already shown mid-turn is a one-line stub. */
export function fmtWait(hub: Hub, room: Room, p: Participant, m: Message): string {
  if (!p.steered?.includes(m.id)) return hub.fmt(room, m);
  return `#${m.seq} ${hub.shown(room, m.from)}: [shown to you mid-turn; still owed: reply_to="${m.id}" or pass]`;
}

/** Peek by seat key: every open room the launched seat's connection is in. */
export function steerPeekSeat(hub: Hub, seatKey: string): SteerItem[] {
  return hub.seatParticipants(seatKey).flatMap(({ room, p }) => steerPending(hub, room, p).map((m) => steerLine(hub, room, m)));
}

export function steerAckSeat(hub: Hub, seatKey: string, ids: string[]): number {
  return hub.seatParticipants(seatKey).reduce((n, { room, p }) => n + steerAck(hub, room, p, ids), 0);
}

/** Peek by participant id (a seat process that knows its id: src/seat.ts). */
export function steerPeek(hub: Hub, roomName: string, pid: string): SteerItem[] {
  const room = hub.getRoom(roomName);
  return steerPending(hub, room, hub.requireParticipant(room, pid)).map((m) => steerLine(hub, room, m));
}

export function steerAckAs(hub: Hub, roomName: string, pid: string, ids: string[]): number {
  const room = hub.getRoom(roomName);
  return steerAck(hub, room, hub.requireParticipant(room, pid), ids);
}

/** Universal fallback: a hub tool result always reaches the model, so pending asks ride on it and count as delivered. */
export function steerCarry(hub: Hub, roomName: string, pid: string): string[] {
  const room = hub.rooms.get(roomName);
  const p = room?.participants.get(pid);
  if (!room || !p) return [];
  const msgs = steerPending(hub, room, p);
  if (msgs.length) steerAck(hub, room, p, msgs.map((m) => m.id));
  return msgs.map((m) => steerLine(hub, room, m).text);
}
