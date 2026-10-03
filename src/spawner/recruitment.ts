import type { Spawner, SpawnerHooks, SpawnerOptions } from "../spawner.js";

export const RUN_PREFIX = /^(swarm-[0-9]{6}(?:-[a-z0-9]{4})?)-/;
export const runPrefix = (room: string) => RUN_PREFIX.exec(room)?.[1] ?? room;

/** The executor and the read-only status use the same configured ceilings. */
export function recruitmentLimits(o: SpawnerOptions) {
  return {
    maxDepth: o.maxDepth ?? Number(process.env.CHATROOM_MAX_RECRUIT_DEPTH ?? 2),
    maxPerRoom: o.maxPerRoom ?? 12,
    maxLive: o.maxLive ?? 24,
    maxPerRequester: o.maxPerRequester ?? Number(process.env.CHATROOM_MAX_RECRUITS_PER_AGENT ?? Infinity),
    maxCumRoom: o.maxCumulativePerRoom ?? Number(process.env.CHATROOM_MAX_RECRUITS_PER_ROOM ?? 12),
    maxCumRun: o.maxCumulativePerRun ?? Number(process.env.CHATROOM_MAX_RECRUITS_PER_RUN ?? 40),
  };
}

export function recruitmentStatus(spawner: Spawner, opts: SpawnerOptions, hooks: SpawnerHooks | undefined, room: string, requester?: string, details = false) {
  const limits = recruitmentLimits(opts);
  const budget = (used: number, limit: number) => ({ used, limit: Number.isFinite(limit) ? limit : null });
  const policy = {
    enabled: process.env.CHATROOM_NO_RECRUIT !== "1",
    held: hooks?.isHeld(room) ?? false,
    policy: { agent: spawner.policy.agent ?? null, model: spawner.policy.model ?? null },
  };
  if (!details) return policy;
  return {
    ...policy,
    budgets: {
      machine_live: budget(hooks?.liveAgents() ?? spawner.live().length, limits.maxLive),
      room_live_recruits: budget(spawner.live(room).length, limits.maxPerRoom),
      room_total_recruits: budget(spawner.agents.filter(a => a.room === room).length, limits.maxCumRoom),
      run_total_recruits: budget(spawner.agents.filter(a => runPrefix(a.room) === runPrefix(room)).length, limits.maxCumRun),
    },
    ...(requester ? { requester: {
      depth: spawner.depthOf(requester),
      max_depth: Number.isFinite(limits.maxDepth) ? limits.maxDepth : null,
      live_recruits: spawner.agents.filter(a => a.requestedBy === requester && a.endedAt === undefined).length,
      max_live_recruits: Number.isFinite(limits.maxPerRequester) ? limits.maxPerRequester : null,
    } } : {}),
  };
}
