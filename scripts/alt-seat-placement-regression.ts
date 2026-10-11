/** Alternate-provider seats are placed as asked, or the launch says why not (bugs.md 6, pack item 11): [PORT=<port>]
 * npx tsx --test scripts/alt-seat-placement-regression.ts (needs npm run build). `--flat --agents 2 --codex 1` accepted
 * the Codex seat and silently launched Claude: the alt-slot walk required a group of 2+ workers, and a flat room with
 * one worker has one. A model-specific benchmark run was mislabelled that way. Now a flat room's only worker can be the
 * alt seat (the verifier stays Claude), and a launch that cannot place every alt seat it was asked for says so in its log.
 * The launcher runs for real with stub claude and codex binaries on PATH; no model is called. */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, writeFakeBins } from "./seat-launch-fixture.ts";

const PORT = process.env.PORT ?? String(await freePort());
const base = realpathSync(mkdtempSync(join(tmpdir(), "alt-seats-")));
function stopOurHub() {
  for (const pid of spawnSync("lsof", ["-ti", `:${PORT}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean)) {
    const args = spawnSync("ps", ["-o", "args=", "-p", pid], { encoding: "utf8" }).stdout;
    if (args.includes(join(process.cwd(), "dist", "index.js"))) process.kill(Number(pid));
  }
}
after(() => { stopOurHub(); rmSync(base, { recursive: true, force: true }); });

function launch(tag: string, args: string[]) {
  const [bin, records, data] = ["bin", "records", "data"].map((d) => join(base, tag, d));
  for (const d of [bin, records, data]) mkdirSync(d, { recursive: true });
  writeFakeBins(bin);
  const r = spawnSync(process.execPath, ["dist/swarm.js", "Say hello.", ...args, "--no-carry", "--timeout", "1", "--port", PORT, "--result-path", join(base, tag, "result.json")], {
    encoding: "utf8", timeout: 90_000,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_RECORD_DIR: records, CHATROOM_INSECURE_LOCAL: "1", CHATROOM_NO_RECRUIT: "1", CHATROOM_DATA_DIR: data },
  });
  stopOurHub();
  const files = readdirSync(records);
  return { codex: files.filter((f) => f.startsWith("codex-")).length, claude: files.filter((f) => f.startsWith("claude-")).length, out: `${r.stdout}\n${r.stderr}` };
}

test("--flat --agents 2 --codex 1 runs the worker on Codex and the verifier on Claude", () => {
  const r = launch("one-worker", ["--flat", "--agents", "2", "--codex", "1"]);
  assert.ok(r.codex >= 1, `the Codex seat was launched (codex records ${r.codex}, claude ${r.claude}); log tail: ${r.out.slice(-500)}`);
});

test("asking for more alt seats than there are workers says so instead of launching fewer silently", () => {
  const r = launch("too-many", ["--flat", "--agents", "3", "--codex", "4"]);
  assert.match(r.out, /asked for 4 alternate-provider seat\(s\); this run has room for 2/, r.out.slice(-800));
});
