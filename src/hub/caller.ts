/**
 * Which seat, if any, sent a loopback HTTP request (swarm-082539-kns2, findings/seat-isolation F1). Under
 * CHATROOM_INSECURE_LOCAL the human routes trust every loopback caller, and every seat's Bash reaches loopback. The OS
 * knows who the caller is even when the request names "benji": lsof maps the request's source port to a process, and a
 * launcher gives every seat process a CHATROOM_SEAT_KEY its children inherit, so the hub walks the caller's ancestors
 * and collects the seat keys on them. Same-user attribution, not a boundary: a detached child with a scrubbed env
 * (`( env -i curl ... & )`) carries no marker and no seat ancestor. It catches a seat's direct curl or script, which is
 * the case on record (round 1: a recruit's bare script drove the live hub). Undefined when the OS cannot say.
 * Every call is asynchronous: a lookup never stalls the hub's other rooms (review by -7).
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

const MAX_DEPTH = 40;
const KEY = /(?:^|\s|\0)CHATROOM_SEAT_KEY=([\w-]{8,100})/g;
const sh = (cmd: string, args: string[]) =>
  new Promise<string | undefined>((done) => execFile(cmd, args, { encoding: "utf8", timeout: 2_000, maxBuffer: 4 << 20 }, (err, out) => done(err ? undefined : out)));

/** The process on this host whose end of a loopback TCP connection is `sourcePort` and whose other end is `hubPort`. */
export async function peerPid(sourcePort: number, hubPort: number): Promise<number | undefined> {
  const out = await sh("lsof", ["-nP", `-iTCP:${sourcePort}`, "-sTCP:ESTABLISHED", "-Fpn"]);
  if (!out) return undefined;
  let pid: number | undefined;
  const mine = new RegExp(`:${sourcePort}->.*:${hubPort}$`);
  for (const line of out.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid !== process.pid && mine.test(line)) return pid;
  }
  return undefined;
}

/** Seat keys in a process's environment (macOS `ps -E` appends it to the command; Linux has /proc). */
async function envKeys(pid: number): Promise<string[]> {
  const text = await readFile(`/proc/${pid}/environ`, "utf8").catch(() => sh("ps", ["-E", "-ww", "-o", "command=", "-p", String(pid)]));
  return text ? [...text.matchAll(KEY)].map((m) => m[1]!) : [];
}

/** Every seat key on the calling process and its ancestors, nearest first; undefined when the caller cannot be found. */
export async function callerSeatKeys(sourcePort: number, hubPort: number): Promise<string[] | undefined> {
  const [pid, table] = await Promise.all([peerPid(sourcePort, hubPort), sh("ps", ["-A", "-o", "pid=,ppid="])]);
  if (!pid || !table) return undefined;
  const parent = new Map(table.trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number) as [number, number]));
  const chain: number[] = [];
  for (let p: number | undefined = pid; p && p > 1 && chain.length < MAX_DEPTH && !chain.includes(p); p = parent.get(p)) chain.push(p);
  const keys: string[] = [];
  for (const found of await Promise.all(chain.map(envKeys))) for (const k of found) if (!keys.includes(k)) keys.push(k);
  return keys;
}
