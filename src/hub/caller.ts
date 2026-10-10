/**
 * Which seat, if any, sent a loopback HTTP request (swarm-082539-kns2, findings/seat-isolation F1). Under
 * CHATROOM_INSECURE_LOCAL the human routes trust every loopback caller, and every seat's Bash reaches loopback. The OS
 * knows who the caller is even when the request names "benji": lsof maps the request's source port to a process, and a
 * launcher gives every seat process a CHATROOM_SEAT_KEY its children inherit, so the hub walks the caller's ancestors
 * and collects the seat keys on them. Same-user attribution, not a boundary: a detached child with a scrubbed env
 * (`( env -i curl ... & )`) carries no marker and no seat ancestor. It catches a seat's direct curl or script, which is
 * the case on record (round 1: a recruit's bare script drove the live hub). Undefined when the OS cannot say.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MAX_DEPTH = 40;
const KEY = /(?:^|\s|\0)CHATROOM_SEAT_KEY=([\w-]{8,100})/g;
const sh = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 2_000 });
  return r.status === 0 ? r.stdout : undefined;
};

/** The process on this host whose end of a loopback TCP connection is `sourcePort` and whose other end is `hubPort`. */
export function peerPid(sourcePort: number, hubPort: number): number | undefined {
  const out = sh("lsof", ["-nP", `-iTCP:${sourcePort}`, "-sTCP:ESTABLISHED", "-Fpn"]);
  if (!out) return undefined;
  let pid: number | undefined;
  for (const line of out.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid !== process.pid && new RegExp(`:${sourcePort}->.*:${hubPort}$`).test(line)) return pid;
  }
  return undefined;
}

/** Seat keys in a process's environment (macOS `ps -E` appends it to the command; Linux has /proc). */
function envKeys(pid: number): string[] {
  let text: string | undefined;
  try { text = readFileSync(`/proc/${pid}/environ`, "utf8"); } catch { text = sh("ps", ["-E", "-ww", "-o", "command=", "-p", String(pid)]); }
  return text ? [...text.matchAll(KEY)].map((m) => m[1]!) : [];
}
const parentOf = (pid: number) => Number(sh("ps", ["-o", "ppid=", "-p", String(pid)])?.trim()) || 0;

/** Every seat key on the calling process and its ancestors, nearest first; undefined when the caller cannot be found. */
export function callerSeatKeys(sourcePort: number, hubPort: number): string[] | undefined {
  let pid = peerPid(sourcePort, hubPort);
  if (!pid) return undefined;
  const keys: string[] = [];
  for (let depth = 0; pid > 1 && depth < MAX_DEPTH; depth++, pid = parentOf(pid)) for (const k of envKeys(pid)) if (!keys.includes(k)) keys.push(k);
  return keys;
}
