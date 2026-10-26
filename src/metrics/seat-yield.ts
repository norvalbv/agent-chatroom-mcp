/**
 * Seat yield per room: how many agent seats a room held, the most at once, how many wrote no finding, and the fewest
 * that wrote 80% of the findings. Owner ask 4 ("how many agents to put into a room"), decision/room-size in
 * swarm-005940-77tu-room: an extra seat adds a seat's cost and a seat's board output inside one room, but landed results
 * do not grow and idle seats rise with size (4% of seats at 2-3, 18% at 13+, over 110 Claude rooms), so a room's record
 * should say whether its size paid. A finding is what runs-table counts as one (src/run-timeline.ts NOT_FINDING,
 * SEEDED_BY), credited to whoever wrote the key first. Seats are agents other than the chair and humans.
 */
import { NOT_FINDING, SEEDED_BY } from "../run-timeline.js";

type Ev = Record<string, any>;

export interface SeatYield {
  room: string;
  agentSeats: number;
  peakSeats: number;
  idleSeats: number;
  seatsFor80: number;
}

export function seatYield(events: readonly Ev[]): SeatYield {
  let room = "";
  const present = new Set<string>();
  const names = new Set<string>();
  const firstBy = new Map<string, string>();
  let peakSeats = 0;
  for (const e of events) {
    if (e.type === "room") room ||= String(e.room ?? "");
    if (e.type === "join" && e.p?.id && e.p.agent !== "human" && e.p.role !== "chair") {
      names.add(String(e.p.name));
      present.add(String(e.p.id)); // a rejoin by a seat already present is not a new seat
      peakSeats = Math.max(peakSeats, present.size);
    }
    if (e.type === "leave" && e.p?.id) present.delete(String(e.p.id));
    const key = String(e.key);
    if (e.type === "board" && e.entry && !NOT_FINDING.test(key) && !SEEDED_BY.has(String(e.entry.by)) && !firstBy.has(key)) firstBy.set(key, String(e.entry.by));
  }
  // a finding by a name that never joined as a seat (the chair, a script) is left out of both the seats and the total
  const per = new Map([...names].map((n) => [n, 0]));
  for (const by of firstBy.values()) if (per.has(by)) per.set(by, per.get(by)! + 1);
  const counts = [...per.values()].sort((a, b) => b - a);
  const total = counts.reduce((a, b) => a + b, 0);
  let seatsFor80 = 0;
  let made = 0;
  while (made < 0.8 * total) made += counts[seatsFor80++];
  return { room, agentSeats: names.size, peakSeats, idleSeats: counts.filter((n) => n === 0).length, seatsFor80 };
}

export function renderSeatYield(rows: readonly SeatYield[]): string {
  let text = "| room | seats (peak) | idle seats | seats making 80% of findings |\n|---|---|---|---|\n";
  for (const r of rows) text += r.agentSeats ? `| ${r.room} | ${r.agentSeats} (${r.peakSeats}) | ${r.idleSeats} | ${r.seatsFor80} |\n` : `| ${r.room} | - | - | - |\n`;
  return text;
}
