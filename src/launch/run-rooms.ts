/**
 * The rooms a run owns besides the ones its launcher made: every room named under the run's prefix, and every room
 * whose parent chain reaches one of the run's rooms. A breakout opened with join_room(parent=) keeps the name its
 * opener gave it (only request_agent(new_room) adds the prefix), so a list by prefix alone missed it: kcj5's verified
 * breakout swarm-005617-verdict-telemetry is absent from swarms/swarm-005617-kcj5/result.json (evidence/breakout-fate).
 * The launcher snapshots these rooms into result.json and report.md and tells each one the run ended; `log` is told
 * which it found by the link alone.
 */
export function runRooms(all: { name: string; parent?: string }[], swarmId: string, roots: string[], log?: (line: string) => void): string[] {
  const owned = new Set(roots);
  for (const r of all) if (r.name.startsWith(`${swarmId}-`)) owned.add(r.name);
  // a breakout of a breakout: follow the links until nothing new joins (a cycle cannot form, but the loop is bounded anyway)
  for (let grew = true, pass = 0; grew && pass < all.length; pass++) {
    grew = false;
    for (const r of all) if (r.parent && owned.has(r.parent) && !owned.has(r.name)) { owned.add(r.name); grew = true; }
  }
  const found = all.map((r) => r.name).filter((n) => owned.has(n) && !roots.includes(n));
  const byLink = found.filter((n) => !n.startsWith(`${swarmId}-`));
  if (byLink.length) log?.(`breakouts found by parent link, not by name: ${byLink.join(", ")}`);
  return found;
}
