/**
 * One embedding per text per model, machine-wide: retrospective scripts share an on-disk cache so a text is sent to the
 * embedder once however many seats or reruns ask for it. Ollama's /api/embed shape ({model, input[]} -> {embeddings}),
 * the endpoint src/hub/overlap/semantic.ts uses. Each vector is one file named sha256(model NUL text), written to a temp
 * name and renamed, so concurrent writers never leave a torn entry. Cosines are the model's own: a cut fitted for one
 * model does not transfer to another (resource/embedder).
 *   npx tsx scripts/embed-cache.ts <texts.json: string[]> [--model embeddinggemma] > vectors.json
 * Env: CHATROOM_EMBED_URL (default http://127.0.0.1:11434/api/embed), CHATROOM_EMBED_CACHE (default /tmp/chatroom-embed-cache).
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

if (process.argv[1] && /^embed-cache\.[cm]?[jt]s$/.test(basename(process.argv[1]))) {
  const args = process.argv.slice(2), mi = args.indexOf("--model");
  const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--model");
  if (!file) { console.error("usage: embed-cache <texts.json: string[]> [--model embeddinggemma]"); process.exit(2); }
  const texts = JSON.parse(readFileSync(file, "utf8")) as string[];
  embedTexts(texts, { model: mi >= 0 ? args[mi + 1] : undefined }).then((v) => console.log(JSON.stringify(v)), (e) => { console.error(String(e)); process.exit(1); });
}
