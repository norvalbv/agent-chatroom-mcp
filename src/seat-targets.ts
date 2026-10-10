/** A distinct starting target for each flat seat (settled axis flat-seats-capped-per-model: duplication is addressed at
 * its cause, distinct targets per seat). Flat seats otherwise get a byte-identical brief, and N copies of one model pick
 * the same target at t≈0, before any claim exists: in swarm-082539-kns2, 5 of 7 workers opened on seed 1 of the brief.
 * The target is a scope taken from the brief's own numbered list, not a persona (MARS, arXiv:2509.20502: reviewer
 * personas added nothing over sampling), and a default rather than a fence: claims still decide who owns what. */

/** The brief's first run of numbered items (1., 2., ... or 1), 2), ...), each cut to its first sentence. Fewer than two
 * items is no list. */
export function briefSeeds(task: string): string[] {
  const out: string[] = [];
  for (const line of task.split("\n")) {
    const m = /^\s*(\d{1,2})[.)]\s+(\S.*)$/.exec(line);
    if (!m) continue;
    if (Number(m[1]) !== out.length + 1) {
      if (out.length >= 2) break; // a second list starts: keep the first
      out.length = 0;
      if (Number(m[1]) !== 1) continue;
    }
    out.push(label(m[2]));
  }
  return out.length >= 2 ? out : [];
}

function label(item: string): string {
  const first = /^(.+?[.!?:])(\s|$)/.exec(item)?.[1] ?? item;
  const t = first.replace(/[.:]$/, "").trim();
  return t.length > 100 ? t.slice(0, 97).trimEnd() + "..." : t;
}

/** One sentence for worker `i` (1-based): seats 1..k open on items 1..k in turn. Once every item has a seat, seat k+j
 * takes a second angle on item j through its own lens, or something the list does not name if the brief asks for more,
 * so the extra seats do not collapse onto one another either. Empty when the brief has no numbered list. */
export function seatTarget(task: string, i: number, lenses: readonly string[]): string {
  const seeds = briefSeeds(task);
  if (!seeds.length) return "";
  const k = seeds.length;
  const tail = "Other seats open on the other items. Claim yours unless someone already has; this is a default, not a fence.";
  if (i <= k) return `Your starting area: item ${i} of the brief's numbered list ("${seeds[i - 1]}"). ${tail}`;
  const j = ((i - 1) % k) + 1;
  const lens = lenses[Math.floor((i - k - 1) / k) % lenses.length];
  return `Your starting area: a second angle on item ${j} of the brief's numbered list ("${seeds[j - 1]}"), through the lens "${lens}", or, if the brief asks to go beyond its list, something the list does not name. ${tail}`;
}
