# todo

Open work for this repo, one file per item. `ls todo/` is the list; nothing else to keep in sync.
Finished or dropped items move to `todo/done/`.

Quick views:

    grep -H '^status:' todo/*.md          # everything with its status
    grep -l '^status: open' todo/*.md     # ready to pick up

## Item format

    ---
    status: open        # open | doing | blocked | idea (idea = not approved by the owner yet)
    added: 2026-09-23
    from: where it came from (a doc, an audit, a room, the owner)
    after: slug-of-another-item   # optional: that item must land first
    owner: benji                  # optional: only when only the owner can do it
    ---
    # Title in plain words

    What, why, and "Done when" (a check someone else can run).

When an item lands, `git mv` it to `todo/done/` and add `done: <date> <commit>` to the frontmatter.
When it is dropped, add `dropped: <date> <reason>` instead.

## Rules

- The pool throughput study (docs/experiments/2026-09-23-pool-throughput.md) is pre-registered, so
  pools 2 and 3 run from branch `study/pool-throughput` (its src/, prompts/
  and skills/ match the ffe5a7cd build pool 1 ran on). Run `scripts/pool.ts` from a worktree of that
  branch: the harness uses the dist/ of the checkout it runs from. main can move freely. Only
  harness measurement fixes are cherry-picked onto the study branch, each recorded in the
  pre-registration.
- Changes still follow docs/research-index.md: cite the source an item came from.
- Never write the hidden pool root, or hidden test file names, into an item.
