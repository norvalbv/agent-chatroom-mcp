/**
 * Board-key prefixes that coordinate rather than deliver, read by every site that asks "is this entry output, work or a
 * finding?". They were four hand-kept lists (output.ts, open-work.ts, work.ts, board.ts), and take/ shipped missing from
 * all four: a seat that wrote only take/x read as having delivered, its claim was not barren, and its take was listed as
 * a finding (merge-review backlog item 3, docs/self-improvement-swarm-003601-tky5.md). A claim is a promise, a take is a
 * reservation, a hold is a switch, and inbox/* is another room's note or its ack. filedigest/<hash> is a cache of a
 * file's contents (prompts/worker.md): the same treatment, since a 300-char summary was listed as an unexamined finding
 * and counted as its writer's evidence (review/4ee42a7e).
 */
export const COORDINATION_PREFIXES: readonly string[] = ["claim/", "take/", "hold/", "inbox/", "filedigest/"];

/** Whether a key is coordination state: nobody's output, no work behind a claim, nothing to attack. */
export const coordinates = (key: string) => COORDINATION_PREFIXES.some((p) => key.startsWith(p));
