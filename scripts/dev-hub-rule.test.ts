/** Offline tests for the seat dev-hub rule: node --import tsx scripts/dev-hub-rule.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { devHubRule, repoRoot } from "../src/env.ts";

test("seats editing this hub are told how to run their build as a private hub", () => {
  const rule = devHubRule(repoRoot);
  for (const part of ["npm run build", "CHATROOM_INSECURE_LOCAL=1 node dist/swarm.js", "--port <free port>", "--models claude-opus-5-5", "by PID", "watched agents use it"]) {
    assert.ok(rule.includes(part), `rule names ${part}`);
  }
});

test("seats editing any other project get no dev-hub rule", () => {
  const none = mkdtempSync(join(tmpdir(), "devhub-none-"));
  assert.equal(devHubRule(none), "");
  const other = mkdtempSync(join(tmpdir(), "devhub-other-"));
  writeFileSync(join(other, "package.json"), JSON.stringify({ name: "some-app" }));
  assert.equal(devHubRule(other), "");
});

test("a protocol-fixed run (CHATROOM_NO_RECRUIT=1) gets no dev-hub rule, so it launches no extra agents", () => {
  const before = process.env.CHATROOM_NO_RECRUIT;
  process.env.CHATROOM_NO_RECRUIT = "1";
  try {
    assert.equal(devHubRule(repoRoot), "");
  } finally {
    if (before === undefined) delete process.env.CHATROOM_NO_RECRUIT;
    else process.env.CHATROOM_NO_RECRUIT = before;
  }
});

/** The flag the rule adds is what lets the launcher create its room on a hub a seat started (seats have it stripped). */
async function createStatus(insecure: boolean): Promise<number> {
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), HOST: "127.0.0.1", CHATROOM_DATA_DIR: mkdtempSync(join(tmpdir(), "devhub-data-")), CHATROOM_SPAWN_DRY: "1" };
  delete env.CHATROOM_HUMAN_TOKEN;
  if (insecure) env.CHATROOM_INSECURE_LOCAL = "1";
  else delete env.CHATROOM_INSECURE_LOCAL;
  const hub = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { cwd: repoRoot, env, stdio: "ignore" });
  try {
    for (let i = 0; i < 100; i++) {
      try {
        await fetch(`http://127.0.0.1:${port}/`);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    const res = await fetch(`http://127.0.0.1:${port}/rooms/dev-check/create`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic: "dev check", quorum: "majority", require_verification: true }) });
    return res.status;
  } finally {
    hub.kill();
  }
}

test("a private hub accepts the launcher's room create only with CHATROOM_INSECURE_LOCAL=1", async () => {
  assert.equal(await createStatus(false), 403);
  assert.equal(await createStatus(true), 201);
});
