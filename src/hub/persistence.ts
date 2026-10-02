/** The Hub's append-only JSONL persistence (one file per room) and its replay on start. */
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeReplyMetrics, type ReplyMetricEvent } from "../reply-metrics.js";
import type { Hub } from "../hub.js";
import { applyBoard, applyBoardManifest } from "./board.js";
import type { Participant, Proposal } from "./types.js";
import type { Opts, Event } from "./internal.js";

function recordReplyMetricEvent(hub: Hub, ev: Event) {
  const roomName = "room" in ev ? ev.room : ev.type === "message" ? ev.msg.room : ev.proposal.room;
  const events = hub.replyMetricEvents.get(roomName) ?? [];
  // Keep only analyzer inputs: no chat bodies, names, sessions or mutable participant references.
  const metric: ReplyMetricEvent = { type: ev.type };
  if (ev.type === "message") {
    const m = ev.msg;
    metric.msg = { id: m.id, seq: m.seq, ts: m.ts, kind: m.kind, tag: m.tag,
      from: { id: m.from.id, agent: m.from.agent }, mentions: m.mentions?.slice(), replyTo: m.replyTo };
  } else if (ev.type === "join" || ev.type === "leave") {
    metric.p = { id: ev.p.id, agent: ev.p.agent };
  } else if (ev.type === "room") metric.createdAt = ev.createdAt;
  else if (ev.type === "refusal" || ev.type === "call_completion") metric.ts = ev.ts;
  else if (ev.type === "state" && ev.conclusion) metric.conclusion = { decidedAt: ev.conclusion.decidedAt };
  else if (ev.type === "proposal") metric.proposal = { createdAt: ev.proposal.createdAt, updatedAt: ev.proposal.updatedAt };
  else if (ev.type === "vote") metric.entry = { ts: ev.entry.ts };
  else if (ev.type === "challenge") metric.challenge = { ts: ev.challenge.ts };
  else if (ev.type === "board") metric.entry = ev.entry ? { updatedAt: ev.entry.updatedAt } : null;
  else if (ev.type === "amend") metric.updatedAt = ev.updatedAt;
  events.push(metric);
  hub.replyMetricEvents.set(roomName, events);
}

export function replyMetricObservationEnd(hub: Hub, roomName: string): string | undefined {
  return analyzeReplyMetrics(hub.replyMetricEvents.get(roomName) ?? []).observation_end ?? undefined;
}

export function persist(hub: Hub, ev: Event) {
  recordReplyMetricEvent(hub, ev);
  if (!hub.dataDir) return;
  const roomName = "room" in ev ? ev.room : ev.type === "message" ? ev.msg.room : ev.proposal.room;
  appendFileSync(join(hub.dataDir, `${roomName}.jsonl`), JSON.stringify(ev) + "\n");
}

export function replay(hub: Hub) {
  if (!hub.dataDir || !existsSync(hub.dataDir)) return;
  for (const file of readdirSync(hub.dataDir).filter((f) => f.endsWith(".jsonl"))) {
    const lines = readFileSync(join(hub.dataDir, file), "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      let ev: Event;
      try {
        ev = JSON.parse(line) as Event;
      } catch {
        console.error(`[hub] skipping unreadable line in ${file} (truncated write?)`);
        continue;
      }
      recordReplyMetricEvent(hub, ev);
      switch (ev.type) {
        case "attention": {
          const p = hub.rooms.get(ev.room)?.participants.get(ev.pid);
          if (p) Object.assign(p, { lastSeenSeq: ev.lastSeenSeq, withheld: ev.withheld,
            quietReceipts: ev.quietReceipts, focusedAsk: ev.focusedAsk, declinedAsks: ev.declinedAsks, declinedAt: ev.declinedAt });
          break;
        }
        case "room": {
          // older logs may lack newer options; fill defaults
          const legacy = ev.opts as Partial<Opts>;
          const opts: Opts = {
            topic: legacy.topic ?? "",
            mode: legacy.mode ?? "free",
            quorum: legacy.quorum ?? "unanimous",
            maxRounds: legacy.maxRounds ?? 0,
            expectedParticipants: legacy.expectedParticipants ?? 0,
            anonymous: legacy.anonymous ?? false,
            maxMessagesPerParticipant: legacy.maxMessagesPerParticipant ?? 0,
            maxMessageChars: legacy.maxMessageChars ?? 4000,
            requireChallenge: legacy.requireChallenge ?? "auto",
            nudgeAfterMs: legacy.nudgeAfterMs ?? 180_000,
            requireVerification: legacy.requireVerification ?? false,
          };
          const room = hub.materialiseRoom(ev.room, opts, ev.createdAt);
          room.telemetryVersion = ev.telemetryVersion;
          break;
        }
        case "message":
          hub.rooms.get(ev.msg.room)?.messages.push(ev.msg);
          break;
        case "join":
        case "leave": {
          const room = hub.rooms.get(ev.room);
          // Chair binding is room state, not participant state: replay it (rejection-safe, see join()).
          if (ev.p.role === "chair" && room && !room.chair) room.chair = ev.p.name;
          // Delivery cursors are deliberately process-local: replay/rejoin must backfill.
          delete ev.p.lastBoardSeen;
          delete ev.p.seenBoardKeys;
          // Participants from a previous process are restored as inactive; they must rejoin.
          const legacyP = ev.p as Partial<Participant> & Pick<Participant, "id" | "name" | "agent" | "joinedAt" | "lastActiveAt" | "lastSeenSeq">;
          room?.participants.set(ev.p.id, { ...legacyP, label: legacyP.label ?? legacyP.name, messageCount: legacyP.messageCount ?? 0, active: false });
          break;
        }
        case "proposal": {
          const room = hub.rooms.get(ev.proposal.room);
          const legacyPr = ev.proposal as Partial<Proposal> & Omit<Proposal, "challenges" | "version">;
          room?.proposals.set(ev.proposal.id, { ...legacyPr, challenges: legacyPr.challenges ?? [], version: legacyPr.version ?? 1 });
          break;
        }
        case "vote": {
          const pr = hub.rooms.get(ev.room)?.proposals.get(ev.proposalId);
          if (pr) hub.applyVote(pr, ev.pid, ev.entry);
          break;
        }
        case "challenge": {
          const pr = hub.rooms.get(ev.room)?.proposals.get(ev.proposalId);
          if (pr) {
            pr.challenges.push(ev.challenge);
            if (ev.votes) pr.votes = ev.votes;
          }
          break;
        }
        case "challenge_status": {
          const c = hub.rooms.get(ev.room)?.proposals.get(ev.proposalId)?.challenges.find((x) => x.id === ev.challengeId);
          if (c) c.status = ev.status;
          break;
        }
        case "board_manifest": {
          const room = hub.rooms.get(ev.room);
          if (room) applyBoardManifest(room, ev.bytes, ev.kind);
          break;
        }
        case "call_completion": {
          const room = hub.rooms.get(ev.room);
          if (room) hub.applyCallCompletion(room, ev.tool, ev.outcome);
          break;
        }
        case "refusal": {
          const room = hub.rooms.get(ev.room);
          if (room) {
            const key = `${ev.tool}: ${ev.reason}`;
            room.refusals = room.refusals ?? {};
            room.refusals[key] = (room.refusals[key] ?? 0) + 1;
          }
          break;
        }
        case "state": {
          const room = hub.rooms.get(ev.room);
          if (room) {
            room.state = ev.state;
            room.conclusion = ev.conclusion;
          }
          break;
        }
        case "opening":
          hub.rooms.get(ev.room)?.openings.set(ev.pid, ev.content);
          break;
        case "drafts_revealed": {
          const room = hub.rooms.get(ev.room);
          if (room) room.draftsRevealed = true;
          break;
        }
        case "drafts_opened": {
          const room = hub.rooms.get(ev.room);
          if (room) room.draftsOpenedAt = ev.at;
          break;
        }
        case "openings_revealed": {
          const room = hub.rooms.get(ev.room);
          if (room) room.openingsRevealed = true;
          break;
        }
        case "kick_vote": {
          const room = hub.rooms.get(ev.room);
          if (room) room.kickVotes.set(ev.vote.target, ev.vote);
          break;
        }
        case "archive": {
          const room = hub.rooms.get(ev.room);
          if (room) room.archived = ev.archived;
          break;
        }
        case "board": {
          const room = hub.rooms.get(ev.room);
          if (!room) break;
          applyBoard(room, ev.key, ev.entry);
          break;
        }
        case "amend": {
          const pr = hub.rooms.get(ev.room)?.proposals.get(ev.proposalId);
          if (pr) {
            pr.text = ev.text;
            pr.version = ev.version;
            // Missing legacy timestamps must clear the previous text's freshness.
            pr.updatedAt = ev.updatedAt;
            pr.votes = ev.votes;
            if (ev.challenges) pr.challenges = ev.challenges;
          }
          break;
        }
      }
    }
  }
}
