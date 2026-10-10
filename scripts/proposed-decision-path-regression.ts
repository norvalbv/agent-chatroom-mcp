/** A run launched from a seat's worktree must not write its proposed decision record into that branch's tracked docs/:
 * three seats of swarm-000525-jcz8 committed (or deleted) files under docs/decisions/proposed that way in one hour.
 * npx tsx scripts/proposed-decision-path-regression.ts */
import assert from "node:assert/strict";
import * as result from "../src/result.js";

assert.equal(typeof (result as Record<string, unknown>).proposedDecisionDir, "function", "result.ts exports proposedDecisionDir");
const { proposedDecisionDir } = result;
const main = "/repo";
const git = (over: Record<string, unknown> = {}) => ({ root: main, commonDir: "/repo/.git", revision: "abc", branch: "main", dirty: false, ...over });
const out = "/repo/swarms/swarm-1";
// the main checkout keeps today's behaviour: the next run's settledAxes() reads it there once promoted
assert.equal(proposedDecisionDir({ cwd: main, canonicalPath: main, git: git() }, out, true), "/repo/docs/decisions/proposed");
// a linked worktree (its git dir is not <root>/.git) gets the record next to the report, untracked
const wt = "/repo/.swarm-worktrees/swarm-1/seat-7";
assert.equal(proposedDecisionDir({ cwd: wt, canonicalPath: wt, git: git({ root: wt, branch: "feature" }) }, out, true), out);
// so does any swarm/* seat branch, even checked out in a plain clone
assert.equal(proposedDecisionDir({ cwd: main, canonicalPath: main, git: git({ branch: "swarm/swarm-1/seat-7" }) }, out, true), out);
// no decision log in the project: nowhere to propose into
assert.equal(proposedDecisionDir({ cwd: main, canonicalPath: main, git: git() }, out, false), null);
// not a git repo: as before
assert.equal(proposedDecisionDir({ cwd: main, canonicalPath: main, git: null }, out, true), "/repo/docs/decisions/proposed");
console.log("PROPOSED DECISION PATH REGRESSION OK");
