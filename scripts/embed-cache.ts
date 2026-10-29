/**
 * One embedding per text per model, machine-wide: retrospective scripts share an on-disk cache so a text is sent to the
 * embedder once however many seats or reruns ask for it. Ollama's /api/embed shape ({model, input[]} -> {embeddings}),
 * the endpoint src/hub/overlap/semantic.ts uses. Each vector is one file named sha256(model NUL text), written to a temp
 * name and renamed, so concurrent writers never leave a torn entry. Cosines are the model's own: a cut fitted for one
 * model does not transfer to another (resource/embedder).
 *   npx tsx scripts/embed-cache.ts <texts.json: string[]> [--model embeddinggemma] > vectors.json
 * Env: CHATROOM_EMBED_URL (default http://127.0.0.1:11434/api/embed), CHATROOM_EMBED_CACHE (default /tmp/chatroom-embed-cache).
 * The core is src/measurements/embed.ts; this file is the CLI.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { embedTexts } from "../src/measurements/embed.js";

export * from "../src/measurements/embed.js";

if (process.argv[1] && /^embed-cache\.[cm]?[jt]s$/.test(basename(process.argv[1]))) {
  const args = process.argv.slice(2), mi = args.indexOf("--model");
  const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--model");
  if (!file) { console.error("usage: embed-cache <texts.json: string[]> [--model embeddinggemma]"); process.exit(2); }
  const texts = JSON.parse(readFileSync(file, "utf8")) as string[];
  embedTexts(texts, { model: mi >= 0 ? args[mi + 1] : undefined }).then((v) => console.log(JSON.stringify(v)), (e) => { console.error(String(e)); process.exit(1); });
}
