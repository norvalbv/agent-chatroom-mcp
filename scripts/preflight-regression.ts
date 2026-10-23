/**
 * Failing-first regression for `swarm --preflight` (swarm-073112-zcd7 claim/launch-preflight).
 *
 * The 22 Oct live-money room traded from a laptop whose link an earlier room had already measured as unfit (VPN, 196 ms
 * RTT, 5% loss) because nothing ran that check at launch (evidence/earlier-rooms). This asserts:
 *  1. the check-line contract: JSON lines parsed, other lines ignored, a command with no lines / non-zero exit / timeout
 *     is a FAIL, never a silent pass;
 *  2. what seats see: a brief block naming every FAIL/WARN and telling them to write needs/<name> before experimenting,
 *     and one quiet line when all is OK; the board resource and report section carry the same lines;
 *  3. --preflight-strict "<cmd>" refuses before anything else happens (no hub, no seat): the launcher exits 2 with the failing
 *     checks. Argv also carries `--flat --groups`, which the launcher rejects at once, so on a build without the
 *     preflight the run still ends immediately (with the wrong message) and starts nothing.
 *
 * RED on 64182f8a: src/launch/preflight.ts does not exist and swarm ignores --preflight.
 * Run: npx tsx scripts/preflight-regression.ts   (part 3 needs `npm run build` first)
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const mod = await import(path.join(root, "src", "launch", "preflight.ts")).catch((e) => { console.error(`RED: src/launch/preflight.ts missing (${e.code ?? e.message})`); process.exit(1); });
const { parsePreflight, runPreflight, preflightBrief, preflightResource, renderPreflight, strictRefusal, PREFLIGHT_RESOURCE_KEY } = mod;

const AT = "2026-10-22T18:55:00.000Z";
const vpn = JSON.stringify({ check: "vpn-route", status: "fail", value: "default route utun7 via 10.5.0.2 (NordLynx)", why: "13 Oct: this link left the btc-5m book 4-18 s behind", fix: "trade from a host with its own clean link" });
const rtt = JSON.stringify({ check: "clob-tls-rtt", status: "warn", value: "p50 160 ms, p90 410 ms, 0/10 lost" });
const clock = JSON.stringify({ check: "clock-offset", status: "ok", value: "+12 ms vs time.apple.com" });

// 1. contract
{
  const r = parsePreflight("kit/netcheck", `netcheck v1\n${vpn}\n{"check":"x","status":"maybe","value":"1"}\n${rtt}\n${clock}\n`, 0, 900, AT);
  assert.equal(r.checks.length, 3);
  assert.equal(r.fails, 1);
  assert.equal(r.warns, 1);
  assert.equal(r.ignoredLines, 2, "a banner and a bad status are ignored, and counted");
  assert.equal(r.error, undefined);
  const none = parsePreflight("kit/netcheck", "Traceback ...\n", 1, 10, AT);
  assert.equal(none.fails, 1, "a crash with no check line is a FAIL");
  assert.match(none.error!, /exited 1 with no check lines/);
  assert.equal(parsePreflight("x", "", 0, 10, AT).fails, 1, "silence is a FAIL, not a pass");
  assert.match(parsePreflight("x", clock, null, 10, AT).error!, /did not finish/, "a timeout is a FAIL even with partial lines");
  const real = runPreflight(`printf '%s\\n' '${clock}' '${rtt}'`, root, 10_000);
  assert.equal(real.checks.length, 2);
  assert.equal(real.exitCode, 0);
  assert.equal(real.fails, 0);
  const missing = runPreflight("/nonexistent/netcheck-xyz", root, 10_000);
  assert.equal(missing.fails, 1, "a command that is not there is a FAIL");
}

// 2. what seats, the board and the report see
{
  const bad = parsePreflight("kit/netcheck", `${vpn}\n${rtt}\n${clock}`, 0, 900, AT);
  const brief = preflightBrief(bad);
  assert.match(brief, /^ENVIRONMENT AT LAUNCH .*1 FAIL, 1 WARN/);
  assert.match(brief, /FAIL vpn-route: default route utun7/);
  assert.match(brief, /WARN clob-tls-rtt: p50 160 ms/);
  assert.doesNotMatch(brief, /clock-offset/, "OK lines stay off the brief");
  assert.match(brief, /needs\/<name>/);
  assert.match(brief, /tell the chair/);
  assert.match(brief, /owner fix: trade from a host/);
  const ok = preflightBrief(parsePreflight("kit/netcheck", clock, 0, 900, AT));
  assert.equal(ok.trim().split("\n").length, 1, "a clean machine costs the brief one line");
  assert.match(ok, /all OK/);
  const res = preflightResource(bad);
  assert.equal(res.key, PREFLIGHT_RESOURCE_KEY);
  assert.ok(res.key.startsWith("resource/"), "a resource/* key, so the hub names it to every seat that joins, recruits included");
  for (const c of ["vpn-route", "clob-tls-rtt", "clock-offset"]) assert.ok(res.text.includes(c), `the board entry keeps every check (${c})`);
  assert.match(renderPreflight(bad), /^## Preflight\n/);
  assert.equal(renderPreflight(undefined), "");
  assert.match(strictRefusal(bad)!, /not starting any seat.*\n- FAIL vpn-route/);
  assert.equal(strictRefusal(parsePreflight("x", rtt, 0, 1, AT)), null, "a WARN does not refuse");
}

// 3. --preflight-strict refuses before anything else
{
  const dist = path.join(root, "dist", "swarm.js");
  assert.ok(existsSync(dist), "npm run build first");
  const r = spawnSync("node", [dist, "preflight regression task", "--flat", "--groups", "/nonexistent/groups.json", "--agents", "1", "--preflight-strict", `printf '%s\\n' '${vpn}'`, "--port", "1"], { cwd: root, encoding: "utf8", timeout: 30_000, env: { ...process.env, CHATROOM_INSECURE_LOCAL: "1" } });
  assert.equal(r.status, 2, `exit 2 expected, got ${r.status}: ${r.stderr}`);
  assert.match(r.stderr, /--preflight-strict: not starting any seat/, `stderr: ${r.stderr.slice(0, 400)}`);
  assert.match(r.stderr, /FAIL vpn-route/);
  const w = spawnSync("node", [dist, "preflight regression task", "--flat", "--groups", "/nonexistent/groups.json", "--agents", "1", "--preflight-strict", `printf '%s\\n' '${rtt}'`, "--port", "1"], { cwd: root, encoding: "utf8", timeout: 30_000, env: { ...process.env, CHATROOM_INSECURE_LOCAL: "1" } });
  assert.doesNotMatch(w.stderr, /not starting any seat/, "a WARN-only preflight passes strict mode and the launch goes on (here to the --groups refusal)");
  assert.match(w.stdout + w.stderr, /preflight: 1 WARN/, "the launcher logs the verdict");
}
console.log("preflight-regression OK");
