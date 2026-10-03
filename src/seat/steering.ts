type Pending = { id: string; room: string; from: string; text: string };
type Identity = { room: string; participant_id: string };

/** Seat-owned delivery at provider boundaries; fetching never acknowledges a message. */
export class SeatSteering {
  private readonly seatKey?: string;
  private readonly received = new Set<string>();
  private readonly acknowledgements = new Map<string, Pending>();
  private readonly ackIdentities = new Map<string, Identity>();

  constructor(private readonly mcpUrl: string | undefined, private readonly identities: () => Identity[]) {
    this.seatKey = mcpUrl ? new URL(mcpUrl).searchParams.get("seat") || undefined : undefined;
  }

  private async post(path: string, body: object): Promise<Record<string, unknown> | undefined> {
    if (!this.mcpUrl) return;
    try {
      const response = await fetch(new URL(path, this.mcpUrl), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) return await response.json() as Record<string, unknown>;
    } catch { /* Liveness/steering failure leaves the ask available through ordinary hub tools. */ }
  }

  async heartbeat(tool: string, args: Record<string, string>, step: number, peek = false): Promise<Pending[]> {
    const identities = this.identities();
    if (!identities.length) return [];
    const detail = String(args.command ?? args.path ?? args.pattern ?? args.url ?? args.key ?? args.content ?? "").slice(0, 300);
    const info = { tool, step, detail, ...(peek ? { peek: true } : {}) };
    const responses = this.seatKey
      ? [await this.post("/heartbeat", { seat_key: this.seatKey, ...info })]
      : await Promise.all(identities.map(identity => this.post(`/rooms/${encodeURIComponent(identity.room)}/heartbeat`, { ...identity, ...info })));
    const rooms = new Set(identities.map(identity => identity.room));
    const pending = new Map<string, Pending>();
    for (const response of responses) {
      if (!Array.isArray(response?.pending)) continue;
      for (const item of response.pending) {
        if (!item || typeof item !== "object") continue;
        const p = item as Partial<Pending>;
        if (typeof p.id !== "string" || typeof p.room !== "string" || typeof p.from !== "string" || typeof p.text !== "string" || !rooms.has(p.room)) continue;
        pending.set(`${p.room}/${p.id}`, p as Pending);
      }
    }
    return [...pending.values()];
  }

  async prepare(step: number): Promise<{ content: string; delivered: () => Promise<void> }> {
    const fresh = (await this.heartbeat("between_steps", {}, step, true)).filter(p => !this.received.has(`${p.room}/${p.id}`));
    return {
      content: fresh.length ? `Hub addressed messages (reply with send_message using the room and reply_to below):\n${fresh.map(p => JSON.stringify({ room: p.room, from: p.from, reply_to: p.id, text: p.text })).join("\n")}` : "",
      delivered: async () => {
        for (const identity of this.identities()) this.ackIdentities.set(identity.room, identity);
        for (const p of fresh) {
          const key = `${p.room}/${p.id}`;
          this.received.add(key);
          this.acknowledgements.set(key, p);
        }
        await this.flush();
      },
    };
  }

  /** Retry failed ACKs after successful completions and once on exit, without reinjecting text. */
  async flush(): Promise<void> {
    for (const identity of this.ackIdentities.values()) {
      const entries = [...this.acknowledgements].filter(([, p]) => p.room === identity.room);
      if (!entries.length) continue;
      const auth = this.seatKey ? { seat_key: this.seatKey } : identity;
      const path = this.seatKey ? "/steer/ack" : `/rooms/${encodeURIComponent(identity.room)}/steer/ack`;
      const response = await this.post(path, { ...auth, ids: entries.map(([, p]) => p.id) });
      if (response) for (const [key] of entries) this.acknowledgements.delete(key);
    }
  }
}
