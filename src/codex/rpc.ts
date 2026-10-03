import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

export interface RpcMessage { id?: number | string; method?: string; params?: any; result?: any; error?: { code: number; message: string } }

/** Codex app-server uses newline-delimited JSON-RPC on stdio, not LSP Content-Length framing. */
export class CodexRpc {
  readonly child: ChildProcessWithoutNullStreams;
  readonly closed: Promise<void>;
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private stopped = false;

  constructor(args: string[], cwd: string, onMessage: (message: RpcMessage) => void, onError: (error: Error) => void, binary = "codex") {
    this.child = spawn(binary, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stderr.pipe(process.stderr);
    const fail = (error: Error) => {
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
      this.pending.clear();
      if (!this.stopped) onError(error);
    };
    this.child.on("error", fail);
    this.child.stdin.on("error", fail);
    this.closed = new Promise((resolve) => this.child.on("close", (code) => { fail(new Error(`Codex app-server exited (${code})`)); resolve(); }));
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      let message: RpcMessage;
      try { message = JSON.parse(line); } catch { fail(new Error("Invalid JSON from Codex app-server")); return; }
      if (message.id !== undefined && !message.method) {
        const request = this.pending.get(Number(message.id));
        if (!request) return;
        this.pending.delete(Number(message.id)); clearTimeout(request.timer);
        if (message.error) request.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
        else request.resolve(message.result);
      } else if (message.id !== undefined) {
        // A noninteractive seat cannot answer approval or user-input requests. Never grant extra permissions.
        if (message.method?.endsWith("requestApproval")) this.write({ id: message.id, result: { decision: "decline" } });
        else this.write({ id: message.id, error: { code: -32601, message: "Noninteractive swarm seat cannot answer this request" } });
      } else onMessage(message);
    });
  }

  private write(message: RpcMessage) { this.child.stdin.write(JSON.stringify(message) + "\n"); }
  notify(method: string, params?: unknown) { this.write({ method, params }); }
  request(method: string, params: unknown): Promise<any> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} timed out`)); }, 15_000);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }
  async stop() {
    this.stopped = true;
    this.child.kill("SIGTERM");
    const timer = setTimeout(() => this.child.kill("SIGKILL"), 2_000);
    await this.closed;
    clearTimeout(timer);
  }
}
