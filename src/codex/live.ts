import { writeFileSync } from "node:fs";
import type { CodexArgsOptions, CodexTurnUsage } from "../codex-seat.js";
import { codexConfigArgs } from "../codex-seat.js";
import { CodexRpc, type RpcMessage } from "./rpc.js";

interface PendingMention { id: string; from: string; room: string; text: string; seq?: number }
interface LiveOptions extends CodexArgsOptions { prompt: string; binary?: string; pollMs?: number; emit?: (event: unknown) => void }

/** Native steering keeps the running turn alive; a failed steer never acknowledges the hub's message. */
export async function runCodexLive(options: LiveOptions): Promise<string> {
  const emit = options.emit ?? ((event) => process.stdout.write(JSON.stringify(event) + "\n"));
  let threadId = "", turnId = "", finished = false, steeringSupported = true, final = "";
  let usage: CodexTurnUsage | undefined;
  let activity: { tool: string; detail: string } | undefined;
  let resolveDone!: () => void, rejectDone!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  // An early process failure may arrive while initialization is still awaited.
  void done.catch(() => {});
  const onMessage = ({ method, params: p }: RpcMessage) => {
    if (p?.threadId !== threadId) return;
    if (method === "thread/tokenUsage/updated") {
      const u = p.tokenUsage?.total;
      if (u && typeof u.inputTokens === "number" && typeof u.outputTokens === "number") usage = {
        input_tokens: u.inputTokens, cached_input_tokens: u.cachedInputTokens,
        cache_write_input_tokens: u.cacheWriteInputTokens, output_tokens: u.outputTokens, reasoning_output_tokens: u.reasoningOutputTokens,
      };
    }
    if (method === "item/started" || method === "item/completed") {
      const item = p.item;
      if (method === "item/started" && item.type === "commandExecution") activity = { tool: "codex", detail: String(item.command ?? "").slice(0, 300) };
      const types: Record<string, string> = { agentMessage: "agent_message", mcpToolCall: "mcp_tool_call", commandExecution: "command_execution" };
      const { aggregatedOutput, exitCode, ...fields } = item;
      emit({ type: method.replace("/", "."), item: {
        ...fields, type: types[item.type] ?? item.type,
        ...(item.status === "inProgress" ? { status: "in_progress" } : {}),
        ...(item.type === "commandExecution" ? { aggregated_output: aggregatedOutput ?? "", exit_code: exitCode ?? null } : {}),
      } });
      if (method === "item/completed" && item.type === "agentMessage") final = item.text;
    }
    if (method === "turn/completed") {
      finished = true; turnId = "";
      emit({ type: "turn.completed", ...(usage ? { usage } : {}), status: p.turn.status });
      if (p.turn.status !== "completed") rejectDone(new Error(`Codex turn ${p.turn.status}: ${p.turn.error?.message ?? "no detail"}`));
      else resolveDone();
    }
  };
  const rpc = new CodexRpc(["app-server", ...codexConfigArgs(options.mcpUrl)], options.cwd, onMessage, rejectDone, options.binary);
  const attempted = new Set<string>();
  const unacked = new Set<string>();
  const key = process.env.CHATROOM_SEAT_KEY, heartbeatUrl = process.env.CHATROOM_HEARTBEAT_URL;
  const post = async (url: string, body: unknown) => {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(2_000) });
    if (!response.ok) throw new Error(`Steering transport HTTP ${response.status}`);
    return response.json();
  };
  const ack = async () => {
    if (!heartbeatUrl || !key || !unacked.size) return;
    const ids = [...unacked];
    await post(new URL("/steer/ack", heartbeatUrl).toString(), { seat_key: key, ids });
    for (const id of ids) unacked.delete(id);
  };
  const poll = async () => {
    if (!heartbeatUrl || !key || !turnId || finished) return;
    try {
      await ack();
      const current = activity;
      const response = await post(heartbeatUrl, { seat_key: key, ...(current ?? { peek: true }) });
      if (activity === current) activity = undefined;
      if (!steeringSupported) return;
      const pending = (Array.isArray(response.pending) ? response.pending : []) as PendingMention[];
      const batch = pending.filter((p) => typeof p.id === "string" && typeof p.text === "string" && !attempted.has(p.id));
      if (!batch.length || finished || !turnId) return;
      const text = batch.map((p) => `[Chatroom ${p.room}, from ${p.from}, reply_to=${p.id}]\n${p.text}`).join("\n\n");
      for (const p of batch) attempted.add(p.id);
      try {
        await rpc.request("turn/steer", { threadId, expectedTurnId: turnId, input: [{ type: "text", text, text_elements: [] }] });
      } catch (error) {
        // A protocol refusal is definitive. A timeout may have accepted the message: leave it to normal hub delivery.
        if (typeof (error as { code?: number }).code === "number") for (const p of batch) attempted.delete(p.id);
        throw error;
      }
      for (const p of batch) unacked.add(p.id);
      emit({ type: "steering.accepted", ids: batch.map((p) => p.id), at: new Date().toISOString() });
      await ack();
    } catch (error) {
      // Unavailable hubs and turn-id races retain the ask for the next delivery path.
      if ((error as { code?: number }).code === -32601) { steeringSupported = false; console.error("Codex binary does not support turn/steer; hub tool delivery remains available."); }
    }
  };
  let polling: Promise<void> = Promise.resolve();
  let timer: NodeJS.Timeout | undefined;
  const stop = () => { finished = true; rejectDone(new Error("Codex seat stopped")); void rpc.stop(); };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  try {
    await rpc.request("initialize", { clientInfo: { name: "chatroom-seat", version: "0.1.0" }, capabilities: {} });
    rpc.notify("initialized");
    const started = await rpc.request("thread/start", { cwd: options.cwd, model: options.model, approvalPolicy: "never", ...(options.readOnly ? { sandbox: "read-only" } : {}) });
    threadId = started.thread?.id;
    if (!threadId) throw new Error("Codex returned no thread id");
    emit({ type: "thread.started", thread_id: threadId });
    emit({ type: "turn.started" });
    const turn = await rpc.request("turn/start", { threadId, input: [{ type: "text", text: options.prompt, text_elements: [] }] });
    if (!finished) turnId = turn.turn?.id;
    if (!finished && !turnId) throw new Error("Codex returned no turn id");
    const schedule = () => { timer = setTimeout(() => { polling = poll().finally(() => { if (!finished) schedule(); }); }, options.pollMs ?? 1_000); };
    if (!finished) schedule();
    await done;
    if (options.outFile) writeFileSync(options.outFile, final);
    return final;
  } finally {
    finished = true;
    clearTimeout(timer);
    await polling;
    try { await ack(); } catch { console.error("Codex steering acknowledgement pending; hub may redeliver."); }
    process.off("SIGTERM", stop); process.off("SIGINT", stop);
    await rpc.stop();
  }
}
