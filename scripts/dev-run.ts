/**
 * Ask the hub you are talking through to build a commit and run a dev room on it, so the room you cite as dev_room
 * in a verify head is one the hub started and watched itself (src/hub/dev-runs.ts). Without this, the receipt is the
 * dev hub's own word and the conclusion reads Verified PARTIAL.
 *
 *   npx tsx scripts/dev-run.ts --hub http://127.0.0.1:7742 --room <your room> --participant-id <your id> \
 *     --commit <sha> --task "<what the dev room's agents should do>" [--agents 3] [--model claude-opus-5-5] [--timeout 15] [--wait]
 *   npx tsx scripts/dev-run.ts --hub http://127.0.0.1:7742 --status <run id>
 *
 * Prints the run record as JSON. With --wait it polls until the run ends and prints the dev_room URL(s) to cite.
 */
const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const hub = (flag("hub") ?? "").replace(/\/$/, "");
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(hub)) {
  console.error("--hub http://127.0.0.1:<port> required: the hub this room runs on");
  process.exit(2);
}
const get = async (path: string) => { const r = await fetch(hub + path); if (!r.ok) throw new Error(`${r.status} ${await r.text()}`); return r.json() as Promise<Record<string, unknown>>; };

async function main() {
  let id = flag("status");
  if (!id) {
    const body = { participant_id: flag("participant-id"), commit: flag("commit"), task: flag("task"), agents: flag("agents") ? Number(flag("agents")) : undefined, model: flag("model"), timeout_min: flag("timeout") ? Number(flag("timeout")) : undefined };
    const r = await fetch(`${hub}/rooms/${encodeURIComponent(flag("room") ?? "")}/dev-runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { console.error(`refused: ${await r.text()}`); process.exit(1); }
    const run = (await r.json()) as { id: string };
    console.log(JSON.stringify(run, null, 2));
    if (!argv.includes("--wait")) return;
    id = run.id;
  }
  for (;;) {
    const run = await get(`/dev-runs/${encodeURIComponent(id)}`);
    if (!argv.includes("--wait") || run.state === "ended" || run.state === "failed") {
      console.log(JSON.stringify(run, null, 2));
      for (const x of (run.rooms as { room: string }[] | undefined) ?? []) console.log(`dev_room: http://127.0.0.1:${run.port}/rooms/${x.room}`);
      process.exit(run.state === "failed" ? 1 : 0);
    }
    await new Promise((res) => setTimeout(res, 15_000));
  }
}
main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
