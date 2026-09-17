/** Shared, routing-based reply proxy for live stats and append-only JSONL replay.
 * Event order (not final Participant.active) is authoritative for membership.
 * This deliberately does not measure task success or infer historical pass times.
 */
export interface ReplyMetricMessage {
  id: string;
  seq: number;
  ts: string;
  kind: string;
  tag?: string;
  from: { id: string; agent: string };
  mentions?: string[];
  replyTo?: string;
}
export interface ReplyMetricEvent {
  type: string;
  room?: string;
  msg?: ReplyMetricMessage;
  p?: { id: string; agent: string; joinedAt?: string };
  ts?: string;
  createdAt?: string;
  updatedAt?: string;
  conclusion?: { decidedAt: string };
  proposal?: { room?: string; createdAt?: string; updatedAt?: string };
  entry?: { ts?: string; updatedAt?: string } | null;
  challenge?: { ts?: string };
}
export interface ReplyMetricOptions {
  windowMinutes?: number;
  /** Evaluation clock. Replay defaults to the final observed timestamp. */
  asOf?: string;
  /** Explicit observation horizon; live callers use now, closed replay uses log end. */
  observationEnd?: string;
  /** Inclusive message prefix; never allows a later reply to credit an earlier ask. */
  maxSeq?: number;
}

export function parseReplyWindowMinutes(value: unknown): number {
  if (value === undefined) return 15;
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) {
    throw new Error('reply_window_minutes must be a finite positive number <= 1440');
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 1440) throw new Error('reply_window_minutes must be a finite positive number <= 1440');
  return n;
}

function timestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : undefined;
}
const isAgent = (agent: string | undefined) => agent !== 'human' && agent !== 'hub' && agent !== 'system';
const isChat = (m: ReplyMetricMessage) => m.kind === 'chat' && m.tag !== 'opening' && isAgent(m.from.agent) && m.from.id !== 'system';

export function analyzeReplyMetrics(input: readonly ReplyMetricEvent[], options: ReplyMetricOptions = {}) {
  const windowMinutes = parseReplyWindowMinutes(options.windowMinutes);
  const windowMs = windowMinutes * 60_000;
  let events = input;
  if (options.maxSeq !== undefined) {
    if (!Number.isSafeInteger(options.maxSeq) || options.maxSeq < 0) throw new Error('maxSeq must be a nonnegative safe integer');
    const stop = input.findIndex(e => e.type === 'message' && e.msg && e.msg.seq > options.maxSeq!);
    const prefix = stop < 0 ? input : input.slice(0, stop);
    let lastMessage = -1;
    prefix.forEach((e, i) => { if (e.type === 'message') lastMessage = i; });
    events = prefix.slice(0, lastMessage + 1);
  }
  let lastTime: number | undefined;
  const agents = new Map<string, string>();
  for (const e of events) {
    if (e.p) agents.set(e.p.id, e.p.agent);
    if (e.msg) agents.set(e.msg.from.id, e.msg.from.agent);
    for (const candidate of [e.ts, e.createdAt, e.updatedAt, e.msg?.ts, e.conclusion?.decidedAt,
      e.proposal?.createdAt, e.proposal?.updatedAt, e.entry?.ts, e.entry?.updatedAt, e.challenge?.ts]) {
      const t = timestamp(candidate);
      if (t !== undefined) lastTime = Math.max(lastTime ?? t, t);
    }
  }
  const parseClock = (value: string | undefined) => {
    const t = timestamp(value);
    if (value !== undefined && t === undefined) throw new Error('Invalid reply metric observation timestamp');
    return t;
  };
  const explicitEnd = parseClock(options.observationEnd);
  const asOf = parseClock(options.asOf) ?? explicitEnd ?? lastTime;
  const end = explicitEnd ?? asOf;
  const membership = new Map<string, boolean>();
  const messages: ReplyMetricMessage[] = [];
  const asks: { message: ReplyMetricMessage; target: string; live: boolean | undefined }[] = [];
  for (const e of events) {
    if ((e.type === 'join' || e.type === 'leave') && e.p) membership.set(e.p.id, e.type === 'join');
    if (e.type !== 'message' || !e.msg) continue;
    const m = e.msg;
    const t = timestamp(m.ts);
    if (end !== undefined && t !== undefined && t > end) continue;
    messages.push(m);
    if (!isChat(m)) continue;
    for (const target of new Set(m.mentions ?? [])) {
      if (target === m.from.id || target === 'system' || !isAgent(agents.get(target))) continue;
      asks.push({ message: m, target, live: membership.get(target) });
    }
  }
  let departed = 0, unknown = 0, live = 0, answered = 0, mature = 0, matureAnswered = 0, activity = 0;
  const byAuthor = new Map<string, ReplyMetricMessage[]>();
  for (const m of messages) {
    const list = byAuthor.get(m.from.id) ?? [];
    list.push(m);
    byAuthor.set(m.from.id, list);
  }
  for (const ask of asks) {
    if (ask.live === undefined) { unknown++; continue; }
    if (!ask.live) { departed++; continue; }
    live++;
    const askedAt = timestamp(ask.message.ts);
    const fullyObserved = askedAt !== undefined && end !== undefined && askedAt + windowMs <= end;
    if (fullyObserved) mature++;
    let replied = false, active = false;
    for (const m of byAuthor.get(ask.target) ?? []) {
      const t = timestamp(m.ts);
      if (m.seq <= ask.message.seq || askedAt === undefined || t === undefined || t < askedAt || t - askedAt > windowMs || m.tag === 'opening') continue;
      active = true;
      if (isChat(m) && (m.replyTo === ask.message.id || m.mentions?.includes(ask.message.from.id))) replied = true;
    }
    if (active) activity++;
    if (replied) { answered++; if (fullyObserved) matureAnswered++; }
  }
  return {
    schema_version: 1,
    window_minutes: windowMinutes,
    as_of: asOf === undefined ? null : new Date(asOf).toISOString(),
    observation_end: end === undefined ? null : new Date(end).toISOString(),
    definition: 'Deduplicated persisted non-opening agent chat/target pairs, public and quiet; membership at ask from ordered join/leave events. Strict reply is later target chat with exact replyTo or persisted @-back within <=window; one reply may credit multiple asks. Syntactic proxy, not task success. Activity counts any later non-opening target post. Unknown membership excluded from live denominator; pending includes early answered pairs.',
    mentions: asks.length,
    to_departed: departed,
    departure_unknown: unknown,
    live_mentions: live,
    answered_within_window: answered,
    reply_rate: live ? answered / live : null,
    mature_live_mentions: mature,
    mature_answered_within_window: matureAnswered,
    mature_reply_rate: mature ? matureAnswered / mature : null,
    pending_live_mentions: live - mature,
    activity_within_window: activity,
    declined_within_window: null,
    decline_coverage: 'unknown',
  };
}
