/** For a script that starts its own hub on a port and then talks to "the hub on that port": call this before the
 * spawn. With something already listening there the script's hub fails to bind and every later request goes to the
 * other one (a recruit's bare run inherited a live hub's PORT, created a room on it and made it launch an agent). */
import { connect } from "node:net";
import { basename } from "node:path";

export async function ownHubPort(port: number, label = "PORT"): Promise<number> {
  const free = await new Promise<boolean>((done) => {
    // connect rather than bind: a listener on 127.0.0.1 does not stop a bind on the wildcard address
    const probe = connect(port, "127.0.0.1").once("connect", () => { probe.destroy(); done(false); }).once("error", () => done(true));
  });
  if (!free) {
    console.error(`${basename(process.argv[1] ?? "script").replace(/\.[cm]?[jt]s$/, "")}: port ${port} (${label}) is already in use; this script only drives a hub it started itself. Pick a free PORT.`);
    process.exit(2);
  }
  return port;
}
