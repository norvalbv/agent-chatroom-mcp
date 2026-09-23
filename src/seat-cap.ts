/**
 * Flat-room seat cap. Every flat worker gets a byte-identical brief, so extra copies of one model add
 * linear cost and duplicate work, not ideas: in swarm-083203-kooz (15 seats) two seats landed the same
 * 157-line salvage 32 s apart (8b9f7d2, 223d512) and about 15% of landed commits were duplication or its
 * cleanup, while $/seat-minute stayed flat across 20 runs (evidence/seat-count, swarm-092653-202z).
 * The launcher therefore refuses more than DEFAULT_MAX_SAME_SEATS workers on one model unless asked.
 */
export const DEFAULT_MAX_SAME_SEATS = 4;

export interface SeatMix {
  workers: number;
  /** --models rotation for claude workers; empty means one default model */
  models: string[];
  codex: number;
  codexModels: string[];
  openrouter: number;
  openrouterModels: string[];
}

/** Workers per (provider, model), as the launcher's rotation assigns them. */
export function seatsPerModel(mix: SeatMix): Map<string, number> {
  const out = new Map<string, number>();
  const spread = (agent: string, n: number, models: string[]) => {
    const list = models.length ? models : ["default"];
    for (let i = 0; i < n; i++) {
      const key = `${agent}:${list[i % list.length]}`;
      out.set(key, (out.get(key) ?? 0) + 1);
    }
  };
  spread("claude", Math.max(0, mix.workers - mix.codex - mix.openrouter), mix.models);
  spread("codex", mix.codex, mix.codexModels);
  spread("openrouter", mix.openrouter, mix.openrouterModels);
  return out;
}

/** The refusal message when a flat room would put more than `max` workers on one model, else null. */
export function seatCapRefusal(mix: SeatMix, max: number): string | null {
  const over = [...seatsPerModel(mix)].filter(([, n]) => n > max);
  if (!over.length) return null;
  const list = over.map(([k, n]) => `${n} x ${k}`).join(", ");
  return `--flat would seat ${list}, over the cap of ${max} workers per model. Same-model seats on one brief duplicate work rather than add ideas (evidence/seat-count, swarm-092653-202z). Spread seats over --models/--codex/--openrouter, lower --agents, or pass --max-same-seats N to ask for it on purpose.`;
}
