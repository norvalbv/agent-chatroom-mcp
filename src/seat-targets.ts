/** A distinct starting target for each flat seat (settled axis flat-seats-capped-per-model: duplication is addressed at
 * its cause, distinct targets per seat). Flat seats otherwise get a byte-identical brief, and N copies of one model pick
 * the same target at t≈0, before any claim exists: in swarm-082539-kns2, 5 of 7 workers opened on seed 1 of the brief.
 * Explicit item/* resources are the task identity shared with coverage; numbered prose is a legacy fallback. A
 * target is a scope, not a persona (MARS, arXiv:2509.20502: reviewer
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

export interface TargetSelection {
  source: "item" | "numbered" | "none";
  items: { key?: string; label: string }[];
}
export interface TargetAssignment {
  seat: string;
  room: string;
  source: TargetSelection["source"];
  key?: string;
  label?: string;
  stage: "dispatch-planned";
}
export interface LaunchTargets extends TargetSelection { assignments: TargetAssignment[] }

/** Coverage already has explicit problem identities. Reusing them avoids assigning numbered operating rules, as
 * happened again in swarm-081014-957g despite the warning after swarm-005940-77tu. One explicit item is valid. */
export function selectTargets(task: string, resources: readonly { key: string; text: string }[] = []): TargetSelection {
  const items = resources.filter((r) => r.key.startsWith("item/") && r.text.trim())
    .map((r) => ({ key: r.key, label: label(r.text.trim().split("\n")[0]) }));
  if (items.length) return { source: "item", items };
  const seeds = briefSeeds(task);
  return { source: seeds.length ? "numbered" : "none", items: seeds.map((text) => ({ label: text })) };
}

export function targetAssignment(targets: TargetSelection, i: number, seat: string, room: string): TargetAssignment {
  const item = i > 0 && targets.items.length ? targets.items[(i - 1) % targets.items.length] : undefined;
  return { seat, room, source: item ? targets.source : "none", ...item, stage: "dispatch-planned" };
}

/** This warns about uncertainty rather than guessing whether a heading means rules or objectives. */
export function targetSelectionNote(targets: TargetSelection): string {
  if (targets.source !== "numbered") return `seat targets: source=${targets.source}, ${targets.items.length} item(s)`;
  return `seat targets WARNING: source=numbered; the first numbered list may be operating rules, not objectives. Selected: ${targets.items.map((x) => JSON.stringify(x.label)).join(", ")}. For explicit objectives, add one ## item: <name> section per objective to --resources; inspect these targets before spending a run.`;
}

function label(item: string): string {
  const first = /^(.+?[.!?:])(\s|$)/.exec(item)?.[1] ?? item;
  const t = first.replace(/[.:]$/, "").trim();
  return t.length > 100 ? t.slice(0, 97).trimEnd() + "..." : t;
}

/** One sentence for worker `i` (1-based): seats 1..k open on items 1..k in turn. Once every item has a seat, seat k+j
 * takes a second angle on item j through its own lens, or something the list does not name if the brief asks for more,
 * so the extra seats do not collapse onto one another either. Empty when the brief has no numbered list. */
export function seatTarget(task: string, i: number, lenses: readonly string[], targets = selectTargets(task)): string {
  if (!targets.items.length) return "";
  const k = targets.items.length;
  const tail = "Other seats open on the other items. Claim yours unless someone already has; this is a default, not a fence.";
  const j = ((i - 1) % k) + 1;
  const item = targets.items[j - 1];
  const name = targets.source === "item" ? `${item.key} ("${item.label}")` : `item ${j} of the brief's numbered list ("${item.label}")`;
  const read = item.key ? ` Read ${item.key} on the board for the full task and name that key in your claim.` : "";
  if (i <= k) return `Your starting area: ${name}.${read} ${tail}`;
  const lens = lenses[Math.floor((i - k - 1) / k) % lenses.length] ?? "independent check";
  return `Your starting area: a second angle on ${name}, through the lens "${lens}", or, if the brief asks to go beyond its list, something the list does not name.${read} ${tail}`;
}
