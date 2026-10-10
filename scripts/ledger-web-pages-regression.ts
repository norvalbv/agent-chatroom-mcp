/** The work ledger counts web pages, not web hosts: npx tsx scripts/ledger-web-pages-regression.ts
 * src/hub/work.ts deduped a web call on its host, so every paper a seat read on arxiv.org was one target. In dev room
 * swarm-084313-a8t8 the verifier told the room "all five ids you cited resolve" while the evidence line gave it "web 1",
 * and the room was read as one that concluded without researching (seed 4). A page is its host, path and query (one
 * arXiv API query per id is a different page); a fragment is not. Repeats of one page still count once. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { countWork } from "../src/hub/work.ts";
import type { Participant } from "../src/hub/types.ts";

const seat = () => ({ id: "p_x", name: "x" }) as unknown as Participant;
const targetOf = (c: ReturnType<typeof countWork>) => (c && typeof c === "object" ? c.target : c);

test("five papers on one host are five pages", () => {
  const p = seat();
  for (const id of ["2312.06942", "2412.04984", "2503.11926", "2506.15740", "2510.09462"]) countWork(p, "web", `https://arxiv.org/abs/${id}`);
  assert.equal(p.work?.web, 5);
});

test("the same page again, or with a fragment or trailing slash, is not new", () => {
  const p = seat();
  for (const u of ["https://arxiv.org/abs/2510.09462", "https://arxiv.org/abs/2510.09462#S3", "https://arxiv.org/abs/2510.09462/", "https://arxiv.org/abs/2510.09462"]) countWork(p, "web", u);
  assert.equal(p.work?.web, 1);
});

test("a shell fetch counts its page, query included", () => {
  const p = seat();
  countWork(p, "web", 'curl -s "https://export.arxiv.org/api/query?id_list=2312.06942"');
  countWork(p, "web", 'curl -s "https://export.arxiv.org/api/query?id_list=2510.09462"');
  countWork(p, "web", 'curl -s "https://export.arxiv.org/api/query?id_list=2510.09462" | head');
  assert.equal(p.work?.web, 2);
});

test("searches stay one target per query, and the persisted target stays short", () => {
  const p = seat();
  countWork(p, "web", "multi-agent debate");
  countWork(p, "web", "multi-agent debate");
  const long = countWork(p, "web", `https://example.org/${"a/".repeat(100)}paper.pdf`);
  assert.equal(p.work?.web, 2);
  assert.ok((targetOf(long) ?? "").length <= 120, "a long URL is shown short");
  assert.match(targetOf(long) ?? "", /example\.org/, "and still names its host");
});
