/**
 * `swarm --resources <file>`: data, tools and limits that already exist on this machine, written to the board of every
 * room of a run as resource/<name> before a seat is started. A statement about the machine, not about earlier rooms,
 * so --no-carry does not drop it. Seats used what a brief named within seconds and never looked for what it did not
 * (evidence/data-not-found), and a recruit or a sibling group reads its room's board, not the launch brief.
 */
import { readFileSync } from "node:fs";

export interface Resource { key: string; text: string }

const BOARD_CAP = 8000;
const SLUG_MAX = 60;

/** One resource per `## <name>` heading: the name, then the text under it. Text above the first heading is the file's
 * own preamble and a heading with nothing under it is dropped. A repeated name is numbered, never overwritten. */
export function parseResources(markdown: string): Resource[] {
  const out: Resource[] = [];
  const used = new Set<string>();
  for (const section of markdown.split(/^## +/m).slice(1)) {
    const nl = section.indexOf("\n");
    const name = (nl < 0 ? section : section.slice(0, nl)).trim();
    const body = nl < 0 ? "" : section.slice(nl + 1).trim();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, SLUG_MAX).replace(/-+$/, "");
    if (!slug || !body) continue;
    let key = `resource/${slug}`;
    for (let n = 2; used.has(key); n++) key = `resource/${slug}-${n}`;
    used.add(key);
    const full = `${name}\n${body}`;
    const marker = `\n[cut at the board cap: ${full.length} chars in the resources file]`;
    out.push({ key, text: full.length <= BOARD_CAP ? full : full.slice(0, BOARD_CAP - marker.length) + marker });
  }
  return out;
}

/** A file the launcher was pointed at and cannot use stops the launch: seats that were meant to be told and were not
 * is the flaw this flag exists for. */
export function loadResources(path: string): Resource[] {
  let markdown: string;
  try { markdown = readFileSync(path, "utf8"); } catch (e) { throw new Error(`--resources ${path} cannot be read (${(e as NodeJS.ErrnoException).code ?? String(e)})`); }
  const resources = parseResources(markdown);
  if (!resources.length) throw new Error(`--resources ${path} has no "## <name>" entry with text under it`);
  return resources;
}

/** Posts the entries to every room, one request per room, and returns a log line for each. A room that does not exist
 * yet answers 202: the hub holds the entries and writes them when the room is created. Any other refusal throws (a hub
 * from an older build has no such route), because the launcher runs this before it starts a seat. */
export async function seedResources(hubUrl: string, rooms: string[], entries: Resource[], opts: { token?: string; launcherToken?: string; fetch?: typeof fetch } = {}): Promise<string[]> {
  const lines: string[] = [];
  for (const room of rooms) {
    const r = await (opts.fetch ?? fetch)(`${hubUrl}/rooms/${encodeURIComponent(room)}/resources`, { method: "POST", headers: { "content-type": "application/json", ...(opts.token ? { "x-chatroom-token": opts.token } : {}), ...(opts.launcherToken ? { "x-chatroom-launcher-token": opts.launcherToken } : {}) }, body: JSON.stringify({ entries }), signal: AbortSignal.timeout(5_000) });
    if (!r.ok) throw new Error(`${room}: the hub at ${hubUrl} did not take the resources (${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}); --resources needs a hub from this build`);
    lines.push(`${room}: ${entries.length} resource${entries.length === 1 ? "" : "s"} ${r.status === 202 ? "held until the room is created" : "on the board"} (${entries.map((e) => e.key.slice("resource/".length)).join(", ")})`);
  }
  return lines;
}
