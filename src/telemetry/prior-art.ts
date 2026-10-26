/**
 * Prior art: whether a room looked for existing code, packages and papers, fetched any, and ran any (inputs/owner-2).
 * In swarm-164210-9f66 no seat searched a code host for 23 minutes on a task with 41 public clones, the owner handed the
 * room two repos at 20 min, a scout cloned 40 repos in one shell loop, and nothing was ever run. Over 71 rooms, 14 of 17
 * whose brief asked for research searched within 10 minutes and 5 of 54 whose brief was silent did; none ran outside
 * code (evidence/research-depth). The ledger could not show it: the target's own API and a GitHub search were both
 * "web", and a long command reached the log as 120 characters and a hash.
 * - priorArt() tags one local step from the whole detail the seat sent (up to 300 characters, scripts/heartbeat-hook.mjs):
 *   search (a code, package or paper site, or a web search that names one), fetch (files from a code host brought to this
 *   machine: a remote clone, a raw file or archive, an install from a repo URL; a raw data file counts too) or run (an interpreter or build whose script or
 *   working directory is inside a remote clone). The clone destinations are remembered per room in `clones`.
 * - researchMetrics() reads a room log: minutes to the first of each, and every outside reference (src/telemetry/
 *   source-refs.ts) as handed in (the topic, the launcher, a human or the chair, an inbox note) or found by a seat.
 *   A log from before the tags is classified from its stored targets, which a long command has lost.
 * Runs fail often and that is no reason to skip them: the best agent set up 16% of research repos end to end
 * (arXiv:2409.07440) and over half of GitTaskBench failures were setup (arXiv:2508.18993); the measure says whether a
 * room tried, and the guidance (skills/swarm/SKILL.md) gives the time box.
 */
import { refsIn } from "./source-refs.js";

export type PriorArt = "search" | "fetch" | "run";
type Ev = Record<string, any>;

const CODE_HOST = /^(github\.com|gist\.github\.com|api\.github\.com|gitlab\.com|bitbucket\.org|codeberg\.org|sourcegraph\.com|grep\.app|huggingface\.co|pypi\.org|(www\.)?npmjs\.com|crates\.io|pkg\.go\.dev|rubygems\.org|packagist\.org)$/i;
const PAPER_HOST = /^((export\.)?arxiv\.org|(api\.)?semanticscholar\.org|paperswithcode\.com|openreview\.net|aclanthology\.org|dl\.acm\.org|scholar\.google\.[a-z.]+|ieeexplore\.ieee\.org|link\.springer\.com|(dx\.)?doi\.org|api\.crossref\.org|api\.openalex\.org)$/i;
/** outside code itself, not a page about it */
const CODE_FETCH = /^(raw\.githubusercontent\.com|codeload\.github\.com|objects\.githubusercontent\.com|files\.pythonhosted\.org|registry\.npmjs\.org)\/|^github\.com\/[^/]+\/[^/]+\/(archive|releases\/download|raw)\/|^api\.github\.com\/repos\/[^/]+\/[^/]+\/(tarball|zipball|contents)/i;
const QUERY = /\b(github|gitlab|repo|repos|repository|open[- ]source|source code|library|package|pypi|npm|crate|arxiv|paper|papers|preprint|prior art|implementation)\b/i;
const URL_PAGE = /(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,}\/[^\s"'#)|>]*|[a-z0-9.-]+\.[a-z]{2,})/i;
const REMOTE = /https?:\/\/(?!127\.0\.0\.1|localhost|\[::1\])|git@|ssh:\/\/|\b(github\.com|gitlab\.com|bitbucket\.org)\b/;
const INSTALL_FROM_REPO = /\b(pip3?|uv\s+pip)\s+install\b[^;&|]*\bgit\+|\bnpm\s+(i|install|add)\b[^;&|]*(github:|https?:\/\/github\.com)/;
const EXEC = /^(python3?|\S*\/python3?|node|deno|bun|npx|npm|pnpm|yarn|pytest|make|cargo|go|uv|poetry|bash|sh|ruby|java|pip3?|\S*\/pip3?|\.\/\S+)$/;
/** options of git clone that take a value as the next word */
const CLONE_ARG = new Set(["--depth", "-b", "--branch", "-o", "--origin", "-c", "--config", "--reference", "-j", "--jobs", "--filter", "--separate-git-dir", "-u", "--upload-pack", "--shallow-since", "--shallow-exclude"]);

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/^["']|["']$/g, ""));

/** A clone of outside code: `gh repo clone`, or `git clone` with a remote URL anywhere in the command (a loop's "$url"). */
export function isRemoteClone(command: string): boolean {
  return /\bgh\s+repo\s+clone\b/.test(command) || (/\bgit\s+clone\b/.test(command) && REMOTE.test(command));
}

/** Where each clone in a command lands: an absolute root (the static part before a shell variable) or a relative name. */
function cloneDestinations(command: string): string[] {
  const out: string[] = [];
  for (const m of command.matchAll(/\b(git\s+clone|gh\s+repo\s+clone)\s+([^;&|\n]*)/g)) {
    const args: string[] = [];
    const w = words(m[2]!);
    for (let i = 0; i < w.length; i++) {
      if (w[i] === "--") break;
      if (w[i]!.startsWith("-")) { if (CLONE_ARG.has(w[i]!)) i++; continue; }
      args.push(w[i]!);
    }
    const [src, dest] = args;
    if (!src) continue;
    const to = dest ?? src.replace(/\/+$/, "").split("/").pop()!.replace(/\.git$/, "");
    const dyn = to.search(/[$`]/);
    const root = dyn < 0 ? to : to.slice(0, to.lastIndexOf("/", dyn) + 1);
    if (root.length >= 3 && root !== "." && root !== "/") out.push(root.replace(/\/+$/, "") + (dyn < 0 ? "" : "/"));
  }
  return out;
}

/** The path is inside one of the clones: under an absolute root, or naming a relative clone as a path segment. */
function inClone(path: string, clones: ReadonlySet<string>): boolean {
  for (const c of clones) {
    if (c.startsWith("/") || c.startsWith("~")) {
      const root = c.endsWith("/") ? c : c + "/";
      if (path === c.replace(/\/$/, "") || path.startsWith(root)) return true;
    } else if (path === c || path.startsWith(c + "/") || path.includes("/" + c + "/") || path.endsWith("/" + c)) return true;
  }
  return false;
}

/** An interpreter, build or install started from inside a clone, or on a script that lives in one. */
function runsClone(command: string, clones: ReadonlySet<string>): boolean {
  let here = false;
  for (const seg of command.split(/&&|\|\||;|\||\n/)) {
    const w = words(seg).filter((x) => !/^\w+=/.test(x));
    if (!w.length) continue;
    if (w[0] === "cd") { here = w[1] ? inClone(w[1], clones) || (here && !w[1].startsWith("/")) : false; continue; }
    if (!EXEC.test(w[0]!)) continue;
    if (/^(\S*\/)?pip3?$/.test(w[0]!) || w[0] === "uv" && w[1] === "pip") {
      const target = w.slice(w.indexOf("install") + 1).find((x) => !x.startsWith("-"));
      if (target && (inClone(target, clones) || (here && target.startsWith(".")))) return true;
      continue;
    }
    const script = w.slice(1).find((x) => !x.startsWith("-"));
    if (w[0]!.startsWith("./") ? here || inClone(w[0]!, clones) : script && (script.startsWith("/") || script.startsWith("~")) ? inClone(script, clones) : here) return true;
  }
  return false;
}

/** The prior-art tag of one local step, or undefined; a remote clone's destination is added to `clones`. */
export function priorArt(cls: string, tool: string, detail: string, clones: Set<string>): PriorArt | undefined {
  const text = String(detail ?? "").replace(/\s+/g, " ").trim();
  if (cls !== "web" && cls !== "run") return undefined;
  if (/^(websearch|web_search)$/i.test(tool)) return QUERY.test(text) ? "search" : undefined;
  // a log from before isRemoteClone classed `gh repo clone` as run (kvkj-b at 1.2 min), so a clone is read from either class
  if (isRemoteClone(text)) { for (const d of cloneDestinations(text)) clones.add(d); return "fetch"; }
  if (cls === "web") {
    const page = URL_PAGE.exec(text.replace(/^.*?(?=https?:\/\/)/, ""))?.[1];
    if (!page) return undefined;
    if (CODE_FETCH.test(page)) return "fetch";
    const host = page.split("/")[0]!;
    return CODE_HOST.test(host) || PAPER_HOST.test(host) ? "search" : undefined;
  }
  if (cls === "run") {
    if (INSTALL_FROM_REPO.test(text)) return "fetch";
    if (clones.size && runsClone(text, clones)) return "run";
  }
  return undefined;
}

export interface ResearchMetrics {
  /** prior-art steps by tag */
  steps: Record<PriorArt, number>;
  /** outside references in the order first seen: handed in (topic, launcher, human, chair, inbox) or found by a seat */
  handed: string[];
  found: string[];
  /** references each seat found first */
  foundBy: Record<string, number>;
  /** true when the tags were read from the hub; false when classified from stored targets (a log before the tags) */
  tagged: boolean;
  firstAt: Partial<Record<PriorArt, string>>;
}

/** Prior-art timing and where each outside reference came from, read from a room log. */
export function researchMetrics(events: readonly Ev[]): ResearchMetrics {
  const tagged = events.some((e) => e.type === "work" && typeof e.prior === "string");
  const steps: Record<PriorArt, number> = { search: 0, fetch: 0, run: 0 };
  const firstAt: ResearchMetrics["firstAt"] = {};
  const roles = new Map<string, string>();
  const names = new Map<string, string>();
  const origin = new Map<string, { handed: boolean; by?: string }>();
  const clones = new Set<string>();
  const see = (text: unknown, handed: boolean, by?: string) => {
    for (const r of refsIn(String(text ?? ""))) if (!origin.has(r)) origin.set(r, { handed, by });
  };
  const outside = (name: string | undefined, agent?: string) => !name || name === "launcher" || agent === "human" || roles.get(name) === "chair" || roles.get(name) === "human";
  for (const e of events) {
    switch (e.type) {
      case "room": see(e.opts?.topic, true); break;
      case "join":
        if (e.p?.name) { roles.set(e.p.name, e.p.agent === "human" ? "human" : e.p.role ?? "worker"); names.set(e.p.id, e.p.name); }
        break;
      case "work": {
        const prior: PriorArt | undefined = tagged ? e.prior : priorArt(e.cls, e.tool, e.key && !String(e.key).startsWith("#") ? e.key : e.target, clones);
        if (prior) { steps[prior]++; firstAt[prior] ??= e.ts; }
        if (e.cls === "web") see(e.target, false, names.get(e.pid));
        break;
      }
      case "board": {
        const by = e.entry?.by;
        see(`${e.key} ${e.entry?.text ?? ""}`, String(e.key).startsWith("inbox/") || outside(by), by);
        break;
      }
      case "message": {
        const m = e.msg ?? {};
        if (m.kind === "system" || m.from?.agent === "hub") break;
        see(m.content, outside(m.from?.name, m.from?.agent), m.from?.name);
        break;
      }
    }
  }
  const handed: string[] = [], found: string[] = [], foundBy: Record<string, number> = {};
  for (const [r, o] of origin) {
    if (o.handed) { handed.push(r); continue; }
    found.push(r);
    if (o.by) foundBy[o.by] = (foundBy[o.by] ?? 0) + 1;
  }
  return { steps, handed, found, foundBy, tagged, firstAt };
}

const when = (m: number | undefined) => (m === undefined ? "never" : `${m} min`);

/** One sentence for the run report. */
export function researchLine(r: ResearchMetrics, minutes: { firstPriorArt?: number; firstCodeFetch?: number; firstThirdPartyRun?: number }): string {
  const refs = `outside references ${r.handed.length} handed in, ${r.found.length} found by seats`;
  if (minutes.firstPriorArt === undefined) return `prior art: no search for existing code, packages or papers; ${refs}${r.tagged ? "" : " (classified from stored targets)"}. `;
  return `prior art: first search ${minutes.firstPriorArt} min, first fetch from a code host ${when(minutes.firstCodeFetch)}, first outside code run ${when(minutes.firstThirdPartyRun)}; ${refs}${r.tagged ? "" : " (classified from stored targets, which miss what a long command lost)"}. `;
}
