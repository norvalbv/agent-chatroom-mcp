/**
 * Which votes an amend keeps, and when a disagree still answers the text (server chair note 3, swarm-164210-9f66,
 * decision/verifier-hold). The 9f66 verifier had checked the final text and was waiting on three [PENDING] breakout
 * slots; it said so by voting disagree "HOLD", every amend dropped that vote, and it re-cast it four times and chatted
 * every 8 minutes to stay under the verifier-silence lapse. The vote tool already said a disagree "stands until you
 * re-vote or that text is amended". Gerrit keeps a Code-Review -2 valid across patch sets and GitHub keeps a "Request
 * changes" review until its author approves (sources/gerrit-config-labels, sources/github-protected-branches).
 * So a vote anchored to a clause the amend kept is still about the text: an agree keeps endorsing it and a disagree keeps
 * objecting to it (or waiting on it). A disagree with no quote resets on any amend, as before.
 */
import { norm } from "../internal.js";
import type { Proposal } from "../types.js";

type VoteEntry = Proposal["votes"][string];

/** The votes an amend to `next` keeps (agrees and disagrees whose quote survives), and the disagrees among them. */
export function keptOnAmend(votes: Proposal["votes"], next: string): { kept: Proposal["votes"]; carried: string[] } {
  const kept: Proposal["votes"] = {};
  for (const [id, v] of Object.entries(votes)) if ((v.vote === "agree" || v.vote === "disagree") && v.quote && norm(next).includes(norm(v.quote))) kept[id] = v;
  return { kept, carried: Object.keys(kept).filter((id) => kept[id].vote === "disagree") };
}

/** A disagree answers the current version: cast on it, or carried by an amend that kept the clause it quotes. */
export function disagreeStands(pr: Proposal, v: VoteEntry | undefined): boolean {
  if (v?.vote !== "disagree") return false;
  if ((v.version ?? pr.version) === pr.version) return true;
  return !!v.quote && norm(pr.text).includes(norm(v.quote));
}

/** How the status view labels a vote cast on an earlier version. One an amend carried is not stale: its clause is still in
 *  the text (review/dd4195b8 nit a: room_status said "stale" of the disagree that blocked_by called standing). A carried
 *  disagree that does not stand (`stands`: its author left) says so (review/dea5937a N2). */
export function versionLabel(pr: Proposal, v: VoteEntry, stands: boolean): { carried?: string; stale?: string } {
  if (v.version === undefined || v.version === pr.version) return {};
  if (!v.quote || !norm(pr.text).includes(norm(v.quote))) return { stale: `cast at v${v.version}` };
  return { carried: `cast at v${v.version}; its quoted clause is unchanged in v${pr.version}${v.vote === "disagree" && !stands ? ", but its author left, so it does not stand" : ""}` };
}

/**
 * Disagrees that stand on the current text. One cast on this version outlives its author (an objection outlives the agent
 * who filed it); a carried one stands only while `present(id)`: before the carry an amend always cleared a departed seat's
 * disagree, so a carried one must not hold a unanimous room for a seat nobody can ask to re-vote
 * (attack/decision/verifier-hold).
 */
export function standingDisagrees(pr: Proposal, present: (id: string) => boolean): { id: string; name: string }[] {
  return Object.entries(pr.votes)
    .filter(([id, v]) => disagreeStands(pr, v) && ((v.version ?? pr.version) === pr.version || present(id)))
    .map(([id, v]) => ({ id, name: v.name }));
}

/** Why a disagree's optional quote is refused, if it is: it must be a verbatim clause of 15+ chars, like an agree's. */
export function disagreeQuoteRefusal(pr: Proposal, quote: string | undefined, closest: (text: string, q: string) => string): string | undefined {
  if (!quote?.trim()) return undefined;
  if (quote.trim().length < Math.min(15, pr.text.trim().length)) return "A disagree's `quote` must be a verbatim clause (15+ chars) from the proposal: the one you object to or are waiting on.";
  if (!norm(pr.text).includes(norm(quote))) return `Your quote is not in ${pr.id} v${pr.version} (${pr.text.length} chars). Quote the clause you object to verbatim, or leave quote out; the closest passage is: "${closest(pr.text, quote)}"`;
  return undefined;
}

/** The amend line's vote clause: whose agree survived and whose disagree stands. */
export function amendVoteNote(survived: string[], standing: string[]): string {
  return `votes reset${survived.length ? ` except ${survived.join(", ")}, whose quoted clause survived` : ""}` +
    (standing.length ? `; ${standing.map((n) => `${n}'s disagree stands`).join(", ")}: its quoted clause is unchanged` : "");
}
