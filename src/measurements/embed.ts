/**
 * One embedding per text per model, machine-wide (moved unchanged from scripts/embed-cache.ts so the run report can embed;
 * the CLI stays there). Ollama's /api/embed shape ({model, input[]} -> {embeddings}); each vector is one file named
 * sha256(model NUL text) under CHATROOM_EMBED_CACHE (default /tmp/chatroom-embed-cache), written to a temp name and renamed.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export interface EmbedOptions { model?: string; url?: string; dir?: string; batch?: number; timeoutMs?: number }

export const cacheKey = (model: string, text: string) => createHash("sha256").update(`${model}\0${text}`).digest("hex");

export async function embedTexts(texts: readonly string[], o: EmbedOptions = {}): Promise<number[][]> {
  const model = o.model ?? "embeddinggemma";
  const url = o.url ?? process.env.CHATROOM_EMBED_URL ?? "http://127.0.0.1:11434/api/embed";
  const dir = join(o.dir ?? process.env.CHATROOM_EMBED_CACHE ?? "/tmp/chatroom-embed-cache", model.replace(/[^\w.-]+/g, "_"));
  mkdirSync(dir, { recursive: true });
  const path = (t: string) => join(dir, `${cacheKey(model, t)}.json`);
  const missing = [...new Set(texts.filter((t) => !existsSync(path(t))))];
  const batch = o.batch ?? 32;
  for (let i = 0; i < missing.length; i += batch) {
    const input = missing.slice(i, i + batch);
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, input }), signal: AbortSignal.timeout(o.timeoutMs ?? 120_000) });
    if (!r.ok) throw new Error(`embed endpoint ${r.status}: ${await r.text()}`);
    const vecs = ((await r.json()) as { embeddings?: number[][] }).embeddings;
    if (!Array.isArray(vecs) || vecs.length !== input.length) throw new Error("embed endpoint returned no embeddings");
    input.forEach((t, j) => { const tmp = `${path(t)}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(vecs[j])); renameSync(tmp, path(t)); });
  }
  return texts.map((t) => JSON.parse(readFileSync(path(t), "utf8")) as number[]);
}
