/**
 * What seats saw fail, read from their Claude Code transcripts (idea/client-side-disconnects, step 1). The hub records
 * the refusals it gives (typed since f7fc3097); a call that never reached it (the seat's MCP client not connected, a
 * reset socket, a tool the client no longer lists) leaves nothing in the room log. In 1,383 transcripts since
 * 2026-10-10 at least 211 of 1,973 failed chatroom calls were of that kind (evidence/refusals-by-guard-from-transcripts).
 * Classes: client:* for a call that did not reach the hub, otherwise the hub's refusal family read from its words (the
 * typed code itself is not in the transcript). Reads one file at a time, line by line.
 */
import { readFileSync } from "node:fs";

const CLIENT: [string, RegExp][] = [
  ["client:not-connected", /is not connected/],
  ["client:no-such-tool", /No such tool available: mcp__chatroom__/],
  ["client:connection-reset", /ECONNRESET/],
  ["client:connection-refused", /ECONNREFUSED|Unable to connect/],
  ["client:timeout", /MCP error -32001|Request timed out/],
];
/** The hub's refusal families, by the words each guard uses (src/hub.ts); the largest ones in the records first. */
const HUB: [string, RegExp][] = [
  ["unread", /arrived while you were composing/],
  ["reply-owed", /You still owe a reply/],
  ["ownership", /replacing it would discard|is held by|is owned by|only its author/],
  ["scrutiny-held", /CLAIMS WITHOUT|have not been attacked, quoted|this refusal is given once per room/],
  ["amend-find", /does not occur in|occurs \d+ times|too short a find|changes nothing/],
  ["amend-stale", /was in v\d+|amended it/],
  ["proposal-open", /is already open \(v/],
  ["needs-verify", /requires verification: before proposing/],
  ["cite-required", /must quote a matching proposal span|An attack must quote/],
  ["duplicate", /already challenged that clause/],
  ["vote-form", /must include `quote`|Your quote is not in|needs `reason`|disagree vote must include/],
  ["size", /Message is \d+ chars|Opening is \d+ chars|capped at \d+/],
  ["human-ask", /addressed that to|already answered|match their register/],
  ["not-found", /^No proposal "|No board entry|does not exist|No participant named/],
  ["inbox-cap", /inbox notes awaiting acknowledgement/],
  ["state", /is already (concluded|withdrawn|adopted|superseded)|only open proposals|is (concluded|closed)\b/],
  ["auth", /not issued to this connection|have not joined|participant_id is not/],
];

export function classifyFailure(text: string): string {
  for (const [cls, re] of [...CLIENT, ...HUB]) if (re.test(text)) return cls;
  return "other";
}

export interface FailureRow { tool: string; cls: string; n: number }

/** Failed mcp__chatroom__* calls in the given transcripts, by tool and class. */
export function transcriptFailures(files: readonly string[]): FailureRow[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    let text = "";
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    const toolOf = new Map<string, string>();
    for (const line of text.split("\n")) {
      if (!line.includes("mcp__chatroom__") && !line.includes('"is_error":true')) continue;
      let e: any;
      try { e = JSON.parse(line); } catch { continue; }
      const parts = Array.isArray(e?.message?.content) ? e.message.content : [];
      for (const part of parts) {
        if (part?.type === "tool_use" && typeof part.name === "string" && part.name.startsWith("mcp__chatroom__")) toolOf.set(part.id, part.name.slice("mcp__chatroom__".length));
        else if (part?.type === "tool_result" && part.is_error && toolOf.has(part.tool_use_id)) {
          const body = Array.isArray(part.content) ? part.content.map((c: any) => c?.text ?? "").join(" ") : String(part.content ?? "");
          const k = `${toolOf.get(part.tool_use_id)}|${classifyFailure(body)}`;
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
      }
    }
  }
  return [...counts].map(([k, n]) => { const [tool, cls] = k.split("|"); return { tool: tool!, cls: cls!, n }; }).sort((a, b) => b.n - a.n);
}
