/** --groups <file.json>: the groups of a run as the operator wrote them, in place of the planner's. Each group gets its
 * own room and its own brief, so two groups can hold opposing briefs (one builds a case, one tries to break it) and talk
 * only among themselves; what crosses between them is what someone posts with post_to_room.
 *
 *   { "done_when": "...", "verifier_directive": "...",
 *     "groups": [ { "id": "build", "title": "Build the case", "workers": 2, "brief": "..." }, ... ] }
 */
import { readFileSync } from "node:fs";

export interface GroupsFile {
  done_when?: string;
  verifier_directive?: string;
  groups: { id: string; title: string; workers: number; directive: string }[];
}

/** Reads and checks a groups file. Throws with the reason a run from it could not work: a room of one cannot conclude,
 * and a group's id names its room. */
export function loadGroups(file: string): GroupsFile {
  let raw: { done_when?: unknown; verifier_directive?: unknown; groups?: unknown };
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`--groups ${file}: ${(e as NodeJS.ErrnoException).code === "ENOENT" ? "no such file" : `not valid JSON (${e instanceof Error ? e.message : String(e)})`}`);
  }
  if (!Array.isArray(raw.groups) || !raw.groups.length) throw new Error(`--groups ${file}: needs a non-empty "groups" array`);
  const seen = new Set<string>();
  const groups = (raw.groups as Record<string, unknown>[]).map((g, i) => {
    const id = String(g.id ?? "");
    if (!/^[a-z0-9][a-z0-9-]{0,23}$/.test(id)) throw new Error(`--groups ${file}: group ${i + 1} needs an id of lower-case letters, digits and hyphens (it names the group's room)`);
    if (seen.has(id)) throw new Error(`--groups ${file}: id "${id}" is used twice`);
    seen.add(id);
    const brief = typeof g.brief === "string" ? g.brief.trim() : "";
    if (!brief) throw new Error(`--groups ${file}: group "${id}" needs a brief`);
    const workers = Number(g.workers ?? 2);
    if (!Number.isInteger(workers) || workers < 2) throw new Error(`--groups ${file}: group "${id}" needs at least 2 workers (a room of one cannot conclude)`);
    return { id, title: typeof g.title === "string" && g.title.trim() ? g.title.trim() : id, workers, directive: brief };
  });
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return { done_when: text(raw.done_when), verifier_directive: text(raw.verifier_directive), groups };
}
