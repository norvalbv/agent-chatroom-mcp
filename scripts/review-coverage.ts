/**
 * Which commits on a branch did someone other than their author review, according to a room's board?
 *
 *   npx tsx scripts/review-coverage.ts <base>..<tip> --log data/<room>.jsonl [--repo dir] [--json]
 *   npx tsx scripts/review-coverage.ts <base>..<tip> --hub http://127.0.0.1:7717 --room <room> [--repo dir] [--json]
 *
 * Evidence-pack item 4 / telemetry gap G14: across 13 runs 5 of 21 verify entries named a merged commit, and the runs
 * table's "reviewed" was a key-name match. An integrator cherry-picks, so the merged SHA is not the SHA the reviewer
 * named. Each commit on the range is joined to the verify/* and review/* entries whose HEAD names it (parseVerifyHead,
 * the same reader the hub's gate uses), through, in order: the SHA itself, a "(cherry picked from commit X)" trailer,
 * the patch-id (a clean pick), or the subject line (a pick whose conflict was resolved by hand: said as such).
 * A review by the commit's own author is a self-review and does not count; neither does a head that fails on shape
 * (exit_code not 0, or no fail-to-pass). Exit 1 when any commit is left without a counting review, so an integrator
 * can run it before the final proposal. Reads only: no git command here changes the repository.
 */
import { spawnSync } from "node:child_process";
import { closeSync, openSync, readSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { failToPassShortfall, isReviewKey, parseVerifyHead } from "../src/hub/types.js";

export type Board = Map<string, { text: string; by: string }>;
export type Via = "sha" | "trailer" | "patch-id" | "subject";
export interface CommitReview { key: string; by: string; commit: string; via: Via; passes: boolean; self: boolean }
export interface CommitCoverage {
  sha: string; subject: string; author: string; reviews: CommitReview[];
  status: "reviewed" | "self-reviewed" | "failing-only" | "unreviewed";
}
export interface Coverage { commits: CommitCoverage[]; summary: { commits: number; reviewed: number; self_reviewed: number; failing_only: number; unreviewed: number } }

/** A room's board as its log left it: the last board event per key, cleared keys gone. Read in chunks, a line at a time. */
export function boardFromLog(path: string): Board {
  const board: Board = new Map();
  const fd = openSync(path, "r");
  const buf = Buffer.alloc(1 << 20);
  let rest = "";
  const line = (l: string) => {
    if (!l.includes('"type":"board"')) return;
    let e: { type?: string; key?: string; entry?: { text?: string; by?: string } | null };
    try { e = JSON.parse(l); } catch { return; }
    if (e.type !== "board" || typeof e.key !== "string") return;
    if (e.entry && typeof e.entry.text === "string") board.set(e.key, { text: e.entry.text, by: String(e.entry.by ?? "") });
    else board.delete(e.key);
  };
  try {
    for (let n = readSync(fd, buf, 0, buf.length, null); n > 0; n = readSync(fd, buf, 0, buf.length, null)) {
      const lines = (rest + buf.toString("utf8", 0, n)).split("\n");
      rest = lines.pop() ?? "";
      lines.forEach(line);
    }
    if (rest) line(rest);
  } finally {
    closeSync(fd);
  }
  return board;
}

/** The same board from a running hub: GET /rooms/<room> carries every entry's text. */
export async function boardFromHub(hub: string, room: string): Promise<Board> {
  const res = await fetch(`${hub.replace(/\/$/, "")}/rooms/${encodeURIComponent(room)}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`GET /rooms/${room}: HTTP ${res.status}`);
  const body = (await res.json()) as { board?: Record<string, { text?: string; by?: string }> };
  return new Map(Object.entries(body.board ?? {}).filter(([, e]) => typeof e.text === "string").map(([k, e]) => [k, { text: e.text!, by: String(e.by ?? "") }]));
}

const git = (repo: string, args: string[], input?: string) => {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", input, maxBuffer: 256 << 20 });
  return r.status === 0 ? r.stdout : undefined;
};
const sameSha = (a: string, b: string) => { const x = a.toLowerCase(), y = b.toLowerCase(); return x.startsWith(y) || y.startsWith(x); };
function patchId(repo: string, sha: string): string | undefined {
  const diff = git(repo, ["show", "--format=", "--no-color", sha]);
  return diff?.trim() ? git(repo, ["patch-id", "--stable"], diff)?.split(/\s+/)[0] || undefined : undefined;
}

export function reviewCoverage(q: { repo: string; range: string; board: Board }): Coverage {
  const { repo } = q;
  // every headed verify/* and review/* entry, with what its commit resolves to in this repository (if it is here at all)
  const heads = [...q.board].flatMap(([key, e]) => {
    const head = isReviewKey(key) ? parseVerifyHead(e.text) : undefined;
    const commit = head?.commit?.trim();
    if (!head || !commit) return [];
    const full = /^[0-9a-f]{4,64}$/i.test(commit) ? git(repo, ["rev-parse", "--verify", "--quiet", `${commit}^{commit}`])?.trim() : undefined;
    return [{
      key, by: e.by, commit, full, passes: head.exit_code === 0 && !failToPassShortfall(head),
      patch: full ? patchId(repo, full) : undefined, subject: full ? git(repo, ["show", "-s", "--format=%s", full])?.trim() : undefined,
    }];
  });
  const list = git(repo, ["rev-list", "--reverse", "--no-merges", q.range]);
  if (list === undefined) throw new Error(`git rev-list ${q.range} failed in ${repo}`);
  const commits = list.split("\n").filter(Boolean).map((sha): CommitCoverage => {
    const [subject = "", author = "", ...body] = (git(repo, ["show", "-s", "--format=%s%n%an%n%b", sha]) ?? "").split("\n");
    const picked = [...body.join("\n").matchAll(/\(cherry picked from commit ([0-9a-f]{7,64})\)/g)].map((m) => m[1]);
    const patch = patchId(repo, sha);
    const reviews = heads.flatMap((h): CommitReview[] => {
      const via: Via | undefined =
        sameSha(h.commit, sha) ? "sha"
        : picked.some((p) => sameSha(p, h.full ?? h.commit)) ? "trailer"
        : patch && h.patch === patch ? "patch-id"
        : h.subject && h.subject === subject ? "subject"
        : undefined;
      return via ? [{ key: h.key, by: h.by, commit: h.commit, via, passes: h.passes, self: h.by === author }] : [];
    });
    const status = reviews.some((r) => r.passes && !r.self) ? "reviewed" : reviews.some((r) => r.passes) ? "self-reviewed" : reviews.length ? "failing-only" : "unreviewed";
    return { sha, subject, author, reviews, status };
  });
  const n = (s: CommitCoverage["status"]) => commits.filter((c) => c.status === s).length;
  return { commits, summary: { commits: commits.length, reviewed: n("reviewed"), self_reviewed: n("self-reviewed"), failing_only: n("failing-only"), unreviewed: n("unreviewed") } };
}

async function main(argv: string[]) {
  const arg = (name: string) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };
  const range = argv.find((a) => a.includes("..") && !a.startsWith("-"));
  const log = arg("--log"), hub = arg("--hub"), room = arg("--room");
  if (!range || (!log && !(hub && room))) {
    console.error("usage: review-coverage.ts <base>..<tip> (--log <room.jsonl> | --hub <url> --room <name>) [--repo dir] [--json]");
    process.exit(2);
  }
  const board = log ? boardFromLog(log) : await boardFromHub(hub!, room!);
  const r = reviewCoverage({ repo: resolve(arg("--repo") ?? "."), range, board });
  if (argv.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else {
    for (const c of r.commits) {
      const how = c.reviews.map((x) => `${x.key} by ${x.by}${x.via === "sha" ? "" : ` (${x.via} of ${x.commit.slice(0, 8)})`}${x.passes ? "" : " FAILS"}${x.self ? " SELF" : ""}`).join("; ");
      console.log(`${c.status.toUpperCase().padEnd(13)} ${c.sha.slice(0, 8)} ${c.author}: ${c.subject.slice(0, 70)}${how ? `\n              ${how}` : ""}`);
    }
    const s = r.summary;
    console.log(`\n${s.reviewed} of ${s.commits} commits on ${range} carry a passing review by someone other than their author` +
      ` (self-reviewed ${s.self_reviewed}, failing only ${s.failing_only}, unreviewed ${s.unreviewed}).`);
  }
  process.exit(r.summary.reviewed === r.summary.commits ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
