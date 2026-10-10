# Proposed decision: repo-untouched-claims-are-checked-against-git-status

From swarm-001115-646s (concluded); report: swarms/swarm-001115-646s/report.md. A human promotes this into docs/decisions/ with `guard-decisions add`; nothing is adopted automatically.

DECISION RECORD (ready for `guard-decisions add`)

- **slug:** `repo-untouched-claims-are-checked-against-git-status`
- **target:** no existing axis changes; this is not a RE-TARGET. It applies `done-means-independently-verified` and `settle-disputes-by-spec-not-count` to a negative claim.
- **context:** A practice-build proposal asserted "Nothing in the repository was edited" while the shared worktree, clean at room creation, had three uncommitted source edits made during the session. The proposer had not run `git status` before asserting it. Left in, the conclusion would have recorded a false statement and hidden concurrent edits to hub code from the owner.
- **ruling:** A conclusion may claim only what a seat observed. "Repo unchanged" must be backed by `git status` against the room's recorded `code_state`. When the tree is dirty and authorship is unknown, the proposal states per-seat writes, lists the modified files, and says authorship is not established. Measurements of a moving target are written as dated snapshots.
- **consequences:** The adopted answer is true as written, and the unexplained edits are surfaced to the owner instead of being covered by a blanket statement.
- **tradeoff:** The conclusion carries an open, unattributed fact rather than a clean "done". It took two extra amendments, and the final amendment passed on carried-over worker votes plus the verifier's.
- **researched:** No external sources were read this run (nothing NEW relative to the SETTLED AXES list). Evidence is local: the six files under `/tmp/seat2/dev1`, `node --test` reruns, `git status` and `git diff` in the worktree, and board entries `evidence/slugify`, `evidence/clamp`, `evidence/chunk`.
- **rejected:**
  - Keeping "nothing was edited" on the workers' word: loses on verifiability, since `git status` contradicted it.
  - Blocking the conclusion until the edits are attributed: loses on scope, since no seat in the room can establish authorship and the task's deliverables are independent of it.
  - Reverting the edits: loses on safety, since the verifier is read-only and the edits likely belong to another live session.
- **revisit-when:** The hub can attribute worktree writes to a connection (for example a per-seat write log), or a room concludes with `code_state` dirty where it was clean at creation and the conclusion does not mention it.
