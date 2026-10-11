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

/** Where `key` is named in a text as a whole key: not as the start of a longer one (exp/Q1 inside exp/Q11) and not as the
 * tail of another (result/x inside attack/result/x). 3 of 20 hand-checked text links were one of those two. -1: nowhere. */
function namedAt(text: string, key: string): number {
  for (let i = text.indexOf(key); i >= 0; i = text.indexOf(key, i + 1)) {
    const before = text[i - 1] ?? " ", after = text.slice(i + key.length, i + key.length + 2);
    if (!/[\w/-]/.test(before) && !/^(?:[\w/]|[-.]\w)/.test(after)) return i;
  }
  return -1;
}

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
  // the entry's whole key, as written or with its slashes as dashes (audit/exp-tidebench-token-cost for
  // exp/tidebench-token-cost: what a verifier wrote unprompted in dev room swarm-191454-7v05-room)
  const dashed = (k: string) => k.replace(/\//g, "-");
  const exact = candidates.filter((k) => k === rest || k === subject || (k.includes("/") && (subject === dashed(k) || subject.startsWith(`${dashed(k)}-`))));
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
  if (best) {
    // several entries can share an id (prereg/Q4, exp/Q4, tasks/Q4). When the check's own text names some of them
    // ("audit of exp/Q1"), those are what it checks; when it names none, the key cannot say which, and it is linked to
    // each (three at most) rather than to a guess. Hand-checked on 20 links from the records: 6 of 20 were a sibling
    // the text contradicted (attack/decision/check-links).
    // and when the text names one that the key also fits less closely ("audit/H4" whose text says evidence/H4-interop,
    // beside a queue entry benchqueue/H4), the text decides
    const said = scored.filter((s) => namedAt(text, s.k) >= 0).map((s) => s.k);
    const tied = scored.filter((s) => s.score === best).map((s) => s.k);
    return (said.length ? said : tied).slice(0, 3).map((k) => ({ of: k, how: "segment" as const }));
  }
  return candidates
    .filter((k) => k.length >= 6 && k.includes("/"))
    .map((k) => ({ k, at: namedAt(text, k) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .slice(0, 3)
    .map((x) => ({ of: x.k, how: "text" as const }));
}

export type Verdict = "holds" | "fails" | "partial";
/** A verdict the checker declared on the first line ("VERDICT: holds|fails|partial ..."), nothing else. Read from prose a
 * verdict is wrong too often to count: of 151 checks in the records 41% state no verdict word and some read backwards
 * ("H1 REFUTED ... It confirms -1's verdict" holds). decision/check-verdict-not-built. */
export function verdictOf(text: string): Verdict | undefined {
  const m = /^\s*verdict\s*[:\-–—]\s*(holds|fails|partial)\b/i.exec(text.split("\n", 1)[0] ?? "");
  return m ? (m[1].toLowerCase() as Verdict) : undefined;
}

/** What the hub says to a check that declares no verdict. */
export const VERDICT_HINT = "Put \"VERDICT: holds|fails|partial — <one clause>\" on this entry's first line so the record says what your check found, not only what it checked; prose is not read for it.";

