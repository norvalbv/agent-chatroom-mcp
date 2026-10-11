/**
 * Imported first by the hub entry. @modelcontextprotocol/sdk calls the global crypto.randomUUID(), which Node 18 does
 * not define: every MCP initialize answered HTTP 400 "crypto is not defined" and a whole run's seats worked
 * uncoordinated (bugs.md 2, swarm-100737-qx7g). package.json engines says which Node is supported; this keeps an
 * older one working rather than failing each connection.
 */
import { webcrypto } from "node:crypto";

const g = globalThis as { crypto?: unknown };
/** true when this process had no global crypto and was given node:crypto's */
export const cryptoPolyfilled = g.crypto === undefined;
if (cryptoPolyfilled) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true, writable: true });
  console.error(`agent-chatroom-mcp: Node ${process.versions.node} has no global crypto; using node:crypto's webcrypto. Supported: Node 20 or later (package.json engines).`);
}
