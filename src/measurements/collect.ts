/**
 * The launcher's half of item/report-wiring: fetch each room's measurements from the hub that kept its log
 * (GET /rooms/:room/measurements) once, at the final snapshot, and fold them into result.json's `measurements` block.
 * A room the hub cannot measure keeps its error beside the others, so the report says which room and why.
 */
import { MEASURE_BUDGET_MS, type RoomMeasurements } from "./room.js";

export interface RunMeasurements {
  schema: "run-measurements-v1";
  /** One per captured room that the hub measured, lead room first. */
  rooms: RoomMeasurements[];
  /** "<room>: <why>" for each captured room with none. */
  errors: string[];
}
interface Measurable { name: string; measurements?: RoomMeasurements; measurementsError?: string }

const isMeasurements = (m: any, room: string): m is RoomMeasurements =>
  !!m && m.schema === "room-measurements-v1" && m.room === room && ["opening_spread", "framing_width", "winner_provenance", "steer_split"].every((k) => typeof m[k]?.status === "string");

/** The hub's whole embedding budget plus 30 s for the log parse and the reply, so a slow embedder costs only its own blocks. */
export const COLLECT_TIMEOUT_MS = MEASURE_BUDGET_MS + 30_000;

/** Sequential, one request per room; the timeout covers a cold embedder load (a cold model took over 2 s here, src/hub/overlap/semantic.ts). */
export async function collectRoomMeasurements(rooms: Measurable[], hubUrl: string, opts: { fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<void> {
  for (const room of rooms) {
    delete room.measurements;
    delete room.measurementsError;
    try {
      const response = await (opts.fetch ?? fetch)(`${hubUrl}/rooms/${encodeURIComponent(room.name)}/measurements`, { signal: AbortSignal.timeout(opts.timeoutMs ?? COLLECT_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const m = await response.json();
      if (!isMeasurements(m, room.name)) throw new Error("measurements room/schema mismatch");
      room.measurements = m;
    } catch (e) { room.measurementsError = String(e); }
  }
}

export function runMeasurements(rooms: readonly Measurable[], lead: string): RunMeasurements {
  const ordered = [...rooms].sort((a, b) => Number(b.name === lead) - Number(a.name === lead));
  return {
    schema: "run-measurements-v1",
    rooms: ordered.flatMap((r) => (r.measurements ? [r.measurements] : [])),
    errors: ordered.flatMap((r) => (r.measurements ? [] : [`${r.name}: ${r.measurementsError ?? "not collected"}`])),
  };
}

/** One launcher log line per room: which blocks came back and why the others did not. */
export function measurementsLogLine(m: RoomMeasurements): string {
  const b = (name: string, x: RoomMeasurements["opening_spread"]) => `${name} ${x.status}${x.status === "ok" ? "" : ` (${x.error ?? x.unknown[0] ?? "?"})`}`;
  return `measurements ${m.room}: ${[b("spread", m.opening_spread), b("width", m.framing_width), b("provenance", m.winner_provenance), b("steers", m.steer_split)].join(", ")}; embedder ${m.embedder.status}${m.embedder.model ? ` ${m.embedder.model}` : ""}; ${m.computed_ms} ms`;
}
