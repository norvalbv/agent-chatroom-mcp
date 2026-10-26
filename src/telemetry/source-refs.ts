/**
 * Outside references in text, one id per source however it was written: `arXiv:2409.07440`, `doi:10.1145/2363.2433`,
 * `gh:owner/repo`, `pypi:name`, `npm:name`, and with `pages` any other non-local web page as host/path (work.ts pageOf).
 * settled.ts knew arXiv ids and DOIs only, so a GitHub repo the owner handed a room and a seat's later fetch of its
 * README through api.github.com could not be matched, and no reader could say whether a source was handed in or found,
 * or found twice (swarm-164210-9f66, inputs/owner-2 and owner-4). The prior-art measures in run-metrics and the
 * re-research measures share this one normaliser.
 */

/** arXiv new-style ids: YYMM.NNNNN with a month of 01-12 and a year from 07, so prices and epochs are not ids. */
const ARXIV_NEW = String.raw`(?:0[7-9]|[1-9]\d)(?:0[1-9]|1[0-2])\.\d{4,5}`;
const ARXIV = new RegExp(String.raw`arXiv:\s*(cs\/\d{7}|${ARXIV_NEW})|arxiv\.org\/(?:abs|pdf|html)\/(${ARXIV_NEW})|id_list=([\d.,v]+)|(?<![\w.\/-])(${ARXIV_NEW})(?:v\d+)?(?![\w\/-]|\.\d)`, "gi");
const DOI = /\b(10\.\d{4,9}\/[^\s"'<>,;)]+)/gi;
/** owner/repo on GitHub's own hosts and from `gh repo clone`; owner names that are site sections are not owners */
const GITHUB = /(?<![\w.-])(?:github\.com|codeload\.github\.com|raw\.githubusercontent\.com)\/([\w.-]+)\/([\w.-]+)|api\.github\.com\/repos\/([\w.-]+)\/([\w.-]+)|\bgh\s+repo\s+clone\s+([\w.-]+)\/([\w.-]+)/gi;
const NOT_OWNER = new Set(["search", "topics", "orgs", "features", "settings", "marketplace", "apps", "sponsors", "login", "about", "pricing", "collections", "trending", "explore", "notifications", "issues", "pulls", "enterprise", "security", "site", "contact", "readme", "events", "users"]);
const PACKAGE = /pypi\.org\/project\/([\w.-]+)|npmjs\.com\/package\/((?:@[\w.-]+\/)?[\w.-]+)/gi;
const URL_PAGE = /https?:\/\/([^\s"'#)|>\]]+)/gi;
const LOCAL = /^(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)(:|\/|$)/i;

const trimEnd = (s: string) => s.replace(/[.,;:]+$/, "");

/** Every outside reference in `text`, normalised, each once, in the order first written. */
export function refsIn(text: string, opts: { pages?: boolean } = {}): string[] {
  const found: { at: number; id: string }[] = [];
  const add = (at: number, id: string) => found.push({ at, id });
  const t = String(text ?? "");
  for (const m of t.matchAll(ARXIV)) {
    if (m[3]) { for (const id of m[3].split(",")) { const v = id.replace(/v\d+$/, ""); if (new RegExp(`^${ARXIV_NEW}$`).test(v)) add(m.index!, `arXiv:${v}`); } continue; }
    add(m.index!, `arXiv:${(m[1] ?? m[2] ?? m[4])!.replace(/v\d+$/, "")}`);
  }
  for (const m of t.matchAll(DOI)) add(m.index!, `doi:${trimEnd(m[1]!).toLowerCase()}`);
  for (const m of t.matchAll(GITHUB)) {
    const owner = (m[1] ?? m[3] ?? m[5])!.toLowerCase();
    const repo = trimEnd((m[2] ?? m[4] ?? m[6])!).replace(/\.git$/i, "").toLowerCase();
    if (!repo || (m[1] && NOT_OWNER.has(owner))) continue;
    add(m.index!, `gh:${owner}/${repo}`);
  }
  for (const m of t.matchAll(PACKAGE)) add(m.index!, m[1] ? `pypi:${trimEnd(m[1]).toLowerCase()}` : `npm:${trimEnd(m[2]!).toLowerCase()}`);
  if (opts.pages) {
    for (const m of t.matchAll(URL_PAGE)) {
      const page = trimEnd(m[1]!).replace(/\/+$/, "");
      if (LOCAL.test(page) || refsIn(page).length) continue; // a paper, repo or package URL is already its own id
      const slash = page.indexOf("/");
      add(m.index!, slash < 0 ? page.toLowerCase() : page.slice(0, slash).toLowerCase() + page.slice(slash));
    }
  }
  const seen = new Set<string>();
  return found.sort((a, b) => a.at - b.at).map((f) => f.id).filter((id) => !seen.has(id) && !!seen.add(id));
}
