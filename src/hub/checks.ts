/**
 * Which board entry a checking entry checks. Research rooms check results, not commits, and name the check after the
 * result in whatever vocabulary the room invents: rerun/T-B3-2-by-break-claude-2 for result/T-B3-2-unconditional-entrants,
 * audit/Q4-partA and valid/Q4-strip for exp/Q4, attack/result/<slug>. The hub linked none of these and the runs table
 * knew one shape (evidence-pack item 4 and caution 3, telemetry gap G3). Of 169 audit/rerun/critique/valid entries in the
 * records since 2026-10-10 the key alone resolves 89, and the text of 56 more names a board key. One resolver, used by
 * the hub when the entry is written and by run-timeline's reviewed column, so the two cannot disagree. No key rule is
 * imposed on seats: this reads what they already write.
 */
import { coordinates } from "./keys.js";
import { parseVerifyHead } from "./types.js";

/** Prefixes rooms have used for an entry whose subject is another entry. */
export const CHECK_PREFIXES: readonly string[] = ["rerun/", "audit/", "review/", "valid/", "critique/", "check/", "attack/", "verify/"];
/** Never the thing checked: coordination, drafts and handoffs, and what a room was given or read rather than found. */
const NOT_CHECKABLE = ["draft/", "handoff/", "help/", "join-request/", "idea/", "resource/", "sources/"];

export interface CheckLink {
  of: string;
  /** key: the rest of the key is the entry's key; segment: it is, or starts with, the entry's last segment or its id;
   * text: the check's text names the entry */
  how: "key" | "segment" | "text";
}

const isCheck = (key: string) => CHECK_PREFIXES.some((p) => key.startsWith(p));
const lastSegment = (key: string) => key.slice(key.lastIndexOf("/") + 1);

/** The entries by other seats that `key` checks, strongest rule first; empty when it is not a check or names nothing. */
export function checksOf(key: string, by: string, text: string, board: Iterable<readonly [string, { by: string }]>): CheckLink[] {
  const prefix = CHECK_PREFIXES.find((p) => key.startsWith(p));
  if (!prefix) return [];
  // a verify/ or review/ entry with a head reviews a commit: that link is the head's (the review event), not a board key's
  if ((prefix === "verify/" || prefix === "review/") && parseVerifyHead(text)) return [];
  const candidates = [...board].filter(([k, e]) => k !== key && e.by !== by && !isCheck(k) && !coordinates(k) && !NOT_CHECKABLE.some((p) => k.startsWith(p))).map(([k]) => k);
  const rest = key.slice(prefix.length);
  // rerun/<id>-by-<seat>, review/<sha>.<seat>, rerun/<slug>-<seat>: the checker's own name is not part of the subject
  let subject = rest.replace(/[-.]by-.+$/, "");
  for (const sep of [".", "-"]) if (subject.endsWith(sep + by)) subject = subject.slice(0, -by.length - 1);
  const exact = candidates.filter((k) => k === rest || k === subject);
  if (exact.length) return exact.map((k) => ({ of: k, how: "key" as const }));
  let best = 0;
  const scored = candidates.flatMap((k) => {
    const seg = lastSegment(k);
    const score = subject === seg ? seg.length // rerun/x for result/x: the whole name, however short
      : seg.length < 2 || subject.length < 2 ? 0 // a one-letter id is a prefix of too much
      : subject.startsWith(`${seg}-`) ? seg.length // audit/Q4-partA for exp/Q4
      // an id that only begins an entry's name ranks under a whole-name match of the same length: rerun/fade is a rerun of
      // result/fade, not of result/fade-v2 (scripts/run-timeline-regression.ts)
      : seg.startsWith(`${subject}-`) ? subject.length - 0.5 // rerun/T-B3-2 for result/T-B3-2-unconditional-entrants
      : 0;
    best = Math.max(best, score);
    return score ? [{ k, score }] : [];
  });
  // several entries can share an id (prereg/Q4, exp/Q4, evidence/Q4): the key cannot say which was rerun, so the check
  // is linked to each (three at most) rather than to a guess; choosing the newest lost 2 of 34 reviewed results in 5y46
  if (best) return scored.filter((s) => s.score === best).slice(0, 3).map((s) => ({ of: s.k, how: "segment" as const }));
  return candidates
    .filter((k) => k.length >= 6 && k.includes("/"))
    .map((k) => ({ k, at: text.indexOf(k) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .slice(0, 3)
    .map((x) => ({ of: x.k, how: "text" as const }));
}
