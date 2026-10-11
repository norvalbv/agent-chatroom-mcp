/**
 * The hub answers MCP initialize on a Node without a global `crypto` (evidence-pack item 11, bugs.md 2, sc-3815;
 * claim/launcher-bugs). Run: npx tsx scripts/node-crypto-regression.ts (PORT=<port> to choose one)
 *
 * @modelcontextprotocol/sdk calls the global crypto.randomUUID(); Node 18 does not define it, so every initialize
 * answered HTTP 400 "ReferenceError: crypto is not defined", five seats ran uncoordinated in one checkout and
 * swarm-100737-qx7g was lost. No Node 18 is installed here, so the global is removed by a preload instead.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** PORT, or a port the OS just handed out and released */
const freePort = () => new Promise<number>((done) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address() as { port: number }; s.close(() => done(port)); }); });
const PORT = process.env.PORT ? Number(process.env.PORT) : await freePort();
const preload = join(mkdtempSync(join(tmpdir(), "no-crypto-")), "no-crypto.mjs");
writeFileSync(preload, 'Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true, writable: true });\n');
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CHATROOM_")));
const hub = spawn(process.execPath, ["--import", preload, "--import", "tsx", "src/index.ts"], { env: { ...env, PORT: String(PORT), CHATROOM_SPAWN_DRY: "1", CHATROOM_INSECURE_LOCAL: "1" }, stdio: ["ignore", "ignore", "pipe"] });
let err = "";
hub.stderr.on("data", (d) => (err += d));
process.on("exit", () => hub.kill());

let failed = 0;
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "node-crypto-regression", version: "1" } } }),
  });
  const body = await res.text();
  assert.equal(res.status, 200, `initialize answered ${res.status}: ${body.slice(0, 160)}`);
  assert.ok(res.headers.get("mcp-session-id"), "a session id was issued");
  console.log("PASS initialize is answered without a global crypto");
} catch (e) {
  failed++;
  console.error(`FAIL initialize is answered without a global crypto: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
}
hub.kill();
if (failed) { console.error("NODE CRYPTO: failed"); process.exitCode = 1; } else console.log("NODE CRYPTO OK");
process.exit();
