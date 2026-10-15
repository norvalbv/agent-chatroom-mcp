/**
 * Same work by meaning, not by words (owner #895: take.ts's HOW_WORDS list is "extremely naive"). Off unless
 * CHATROOM_EMBED_URL names an embedding endpoint (Ollama's /api/embed shape: {model, input[]} -> {embeddings}); advisory
 * only, never a refusal. Board evidence/take-matcher-labels: 609 labelled pairs from 215 room logs. Equal key words
 * refuse 1 of the 6 duplicate take pairs there and refused 2 reruns in the logs; embeddinggemma on key + text at cosine
 * >= 0.869 fired on 5 of 13,031 take/take and take/claim pairs, all 5 the same work (3 that no word rule found). A cut
 * fitted on half the pairs scored 0.90 precision on the other half (n=21), so it advises; 5 hits cannot bound a refusal's
 * false rate (sources/take-matcher: the rule of three wants 300). Claim vs claim stays on board.ts's stem rule, which
 * measured better there (S∪P precision 0.89 at 272/377 recall).
 * Asynchronous with a hard timeout (10 s: a cold model load on this machine took over 2 s, warm checks 41-113 ms), after
 * the write: a dead endpoint costs a semantic_check record, never a delay.
 */
import type { Hub } from "../../hub.js";
import { commitsIn } from "../internal.js";
import type { Participant, Room } from "../types.js";
import { workWords } from "../take.js";

/** The cut is the model's: cosines are not comparable across models (MTEB, arXiv:2210.07316), so an unknown model needs CHATROOM_EMBED_MIN. */
const MODEL_MIN: Record<string, number> = { embeddinggemma: 0.869 };
const CACHE_MAX = 2000;
const cache = new Map<string, number[]>();

export function semanticConfig(env = process.env) {
  const url = env.CHATROOM_EMBED_URL?.trim();
  if (!url) return undefined;
  const model = env.CHATROOM_EMBED_MODEL?.trim() || "embeddinggemma";
  const min = Number(env.CHATROOM_EMBED_MIN) || MODEL_MIN[model.split(":")[0]!];
  return min ? { url, model, min, timeoutMs: Number(env.CHATROOM_EMBED_TIMEOUT_MS) || 10_000 } : undefined;
}

/** What is embedded: the key's words and the entry's prose (a claim's JSON strings minus who/where fields), as scored offline. */
export function workText(key: string, text: string): string {
  let body = text;
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    if (j && typeof j === "object") body = Object.entries(j).filter(([k, v]) => typeof v === "string" && !["owner", "status", "worktree", "branch", "reviewer"].includes(k)).map(([, v]) => v).join(" ");
  } catch { /* a take is a plain line */ }
  return `${key.replace(/^(take|claim)\//, "").replace(/[-_/.:]+/g, " ")}: ${body}`.slice(0, 500);
}

const cosine = (a: number[], b: number[]) => {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { d += a[i]! * b[i]!; x += a[i]! * a[i]!; y += b[i]! * b[i]!; }
  return d / (Math.sqrt(x * y) || 1);
};

async function embed(cfg: NonNullable<ReturnType<typeof semanticConfig>>, texts: string[]): Promise<number[][]> {
  const missing = [...new Set(texts.filter((t) => !cache.has(`${cfg.model}\n${t}`)))];
  if (missing.length) {
    const r = await fetch(cfg.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: cfg.model, input: missing }), signal: AbortSignal.timeout(cfg.timeoutMs) });
    if (!r.ok) throw new Error(`embed endpoint ${r.status}`);
    const vecs = ((await r.json()) as { embeddings?: number[][] }).embeddings;
    if (!Array.isArray(vecs) || vecs.length !== missing.length) throw new Error("embed endpoint returned no embeddings");
    missing.forEach((t, i) => { cache.set(`${cfg.model}\n${t}`, vecs[i]!); if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!); });
  }
  return texts.map((t) => cache.get(`${cfg.model}\n${t}`)!);
}

/**
 * After a take or a claim is written: compare it with the other active seats' open takes (and, for a take, their open
 * claims) by meaning, and @-name both seats once on the closest pair at or above the model's cut. Pairs with equal key
 * words are skipped: take.ts already refused or noticed them. Returns the promise so tests can await it; setBoard does not.
 */
export function noticeSemantic(hub: Hub, room: Room, p: Participant, key: string): Promise<void> | undefined {
  const cfg = semanticConfig();
  const mine = room.board.get(key);
  if (!cfg || p.agent === "human" || !mine?.text.trim() || commitsIn(key).length) return undefined;
  const isTake = key.startsWith("take/"), words = workWords(room, key);
  const open = (t: string) => { try { return (JSON.parse(t) as { status?: string }).status !== "released"; } catch { return true; } };
  if (!isTake && !open(mine.text)) return undefined;
  const others = [...room.board].flatMap(([k, e]) => {
    // claim vs claim is noticeClaimOverlap's (board.ts); commit takes have their own rules (take.ts commitTake)
    if (k === key || !e.text.trim() || commitsIn(k).length || !(k.startsWith("take/") || (isTake && k.startsWith("claim/"))) || !open(e.text)) return [];
    const owner = [...room.participants.values()].filter((x) => x.name === (e.holder ?? e.by)).at(-1);
    if (!owner?.active || owner.id === p.id || (owner.session && p.session && owner.session === p.session) || (words && workWords(room, k) === words)) return [];
    return [{ key: k, owner, text: workText(k, e.text) }];
  });
  if (!others.length) return undefined;
  const t0 = Date.now(), text = workText(key, mine.text);
  return embed(cfg, [text, ...others.map((o) => o.text)]).then(([v, ...vs]) => {
    const scored = others.map((o, i) => ({ ...o, cos: cosine(v!, vs[i]!) })).sort((a, b) => b.cos - a.cos);
    const best = scored[0]!;
    // the room may have moved on while the endpoint answered: the entry must still be this one, and the other still held
    const still = room.board.get(key) === mine && room.board.get(best.key)?.text.trim() && best.owner.active;
    const notify = best.cos >= cfg.min && !!still;
    hub.persist({ type: "semantic_check", room: room.name, key, other: best.key, by: p.name, other_by: best.owner.name, model: cfg.model, cos: +best.cos.toFixed(4), min: cfg.min, compared: others.length, notified: notify, ms: Date.now() - t0, ts: new Date().toISOString() });
    if (!notify) return;
    hub.persist({ type: "overlap_notice", room: room.name, key, other: best.key, by: p.name, other_by: best.owner.name, rule: "semantic", shared_pct: Math.round(best.cos * 100), ts: new Date().toISOString() });
    hub.post(room, "chat", undefined,
      `@${p.name} your "${key}" reads like the same work as @${best.owner.name}'s "${best.key}" (meaning match, cosine ${best.cos.toFixed(2)}). ` +
      `If it is: agree who does it, or split it explicitly. If it is not, say how it differs. Advisory only, both stand.`);
  }, (err: Error) => {
    hub.persist({ type: "semantic_check", room: room.name, key, by: p.name, model: cfg.model, compared: others.length, notified: false, error: String(err?.name === "TimeoutError" ? "timeout" : err?.message ?? err).slice(0, 120), ms: Date.now() - t0, ts: new Date().toISOString() });
  }).catch(() => undefined); // a throw while posting (a room closed meanwhile) must not become an unhandled rejection in the hub
}
