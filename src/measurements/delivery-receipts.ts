/** Observable body handoffs and explicit subsequent message references; never a causal classifier. */
type Event = Record<string, any>;
type SourceKind = "peer" | "hub" | "human";
export function receiptContains(e: Event, seq: number): boolean {
  return e.type === "delivery_receipt" && Array.isArray(e.seq_ranges) && e.seq_ranges.length <= 64 &&
    e.seq_ranges.every((r: unknown) => Array.isArray(r) && r.length === 2 && Number.isSafeInteger(r[0]) && Number.isSafeInteger(r[1]) && r[0] > 0 && r[1] >= r[0]) &&
    e.seq_ranges.some(([lo, hi]: number[]) => seq >= lo! && seq <= hi!);
}

/** Match explicit reply_to, #seq, and quoted text (at least 12 chars) against earlier incoming messages. */
export function deliveryCoverage(events: Event[]) {
  const messages = new Map<number, Event>(), ids = new Map<string, number>(), names = new Map<string, string>();
  const received = new Map<string, Map<number, { event: number; via: string; ts: string | null }>>();
  const references: { response_seq: number; source_seq: number; source_kind: SourceKind; seat: string; covered: boolean; via: string | null; receipt_event: number | null; receipt_ts: string | null }[] = [];
  let receiptBytes = 0, logBytes = 0, receiptEvents = 0, bodyHandoffs = 0, messageEvents = 0;
  const anonymous = events.find(e => e.type === "room")?.opts?.anonymous === true;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!, bytes = Buffer.byteLength(JSON.stringify(e) + "\n"); logBytes += bytes;
    if (e.type === "join" && e.p) names.set(e.p.id, anonymous ? e.p.label ?? "anonymous seat" : e.p.name ?? "unknown seat");
    if (e.type === "delivery_receipt") {
      receiptBytes += bytes; receiptEvents++;
      const seen = received.get(e.participant) ?? new Map();
      for (const seq of messages.keys()) if (receiptContains(e, seq)) {
        bodyHandoffs++;
        if (!seen.has(seq)) seen.set(seq, { event: i, via: e.via, ts: typeof e.ts === "string" ? e.ts : null });
      }
      received.set(e.participant, seen);
    }
    if (e.type !== "message" || !e.msg) continue;
    const m = e.msg; messageEvents++;
    if (m.from?.id && m.from.id !== "system" && m.from.agent !== "human") {
      const cited = new Set<number>();
      if (ids.has(m.replyTo)) cited.add(ids.get(m.replyTo)!);
      for (const match of String(m.content ?? "").matchAll(/#(\d+)\b/g)) cited.add(Number(match[1]));
      const quotes = [...String(m.content ?? "").matchAll(/["“]([^"”]{12,})["”]/g)].map(q => q[1]!);
      for (const [seq, source] of messages) if (quotes.some(q => String(source.content ?? "").includes(q))) cited.add(seq);
      for (const seq of cited) {
        const source = messages.get(seq);
        if (!source || source.from?.id === m.from.id) continue;
        const receipt = received.get(m.from.id)?.get(seq);
        const source_kind: SourceKind = source.from?.id === "system" ? "hub" : source.from?.agent === "human" ? "human" : "peer";
        references.push({ response_seq: m.seq, source_seq: seq, source_kind, seat: names.get(m.from.id) ?? "unknown seat", covered: !!receipt,
          via: receipt?.via ?? null, receipt_event: receipt?.event ?? null, receipt_ts: receipt?.ts ?? null });
      }
    }
    messages.set(m.seq, m); ids.set(m.id, m.seq);
  }
  const covered = references.filter(r => r.covered).length, n = references.length;
  const channels = Object.fromEntries((["peer", "hub", "human"] as const).map(kind => {
    const refs = references.filter(r => r.source_kind === kind), known = refs.filter(r => r.covered).length;
    return [kind, { n: refs.length, covered: known, unknown: refs.length - known }];
  }));
  return { schema: "delivery-receipts-v1", n, covered, unknown: n - covered, coverage: n ? covered / n : null,
    channels,
    receipt_events: receiptEvents, body_handoffs: bodyHandoffs, message_events: messageEvents,
    receipt_bytes: receiptBytes, receipt_bytes_per_message: messageEvents ? receiptBytes / messageEvents : null,
    receipt_bytes_per_handoff: bodyHandoffs ? receiptBytes / bodyHandoffs : null,
    log_bytes: logBytes, added_log_fraction: logBytes > receiptBytes ? receiptBytes / (logBytes - receiptBytes) : null,
    unknown_reason: !receiptEvents ? "log has no explicit delivery receipts" : !n ? "no explicit incoming-message references" : null,
    scope: "Earlier explicit incoming reply_to, #seq or quoted-text references, partitioned by peer/hub/human source. Proposal/conclusion document envelopes and board bodies are outside message-body coverage. Hub handoff is not transport success or understanding; causality unproven.", references };
}
