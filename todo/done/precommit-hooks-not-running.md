---
status: done
added: 2026-09-23
from: reuse/sandbox build report; checked in the main checkout
owner: benji
done: 2026-09-24 guard-only by owner's choice: scripts/install-guard-hook.sh writes .husky/_/pre-commit running only the baseline-freeze guard (devkit block stays off); rerun it after any npm run prepare
---
# The repo's pre-commit hooks are not running

git config core.hooksPath is .husky/_, but .husky/_ does not exist (husky creates it in
`npm run prepare`), so git runs no hooks at all. .husky/pre-commit, including the baseline-freeze
guard required by docs/decisions/done-means-independently-verified.md rule (3), has been skipped on
every commit since it went missing.

Fixing it runs husky's prepare (which sets core.hooksPath itself) and `devkit sync-hook-runner`.
Owner's call because devkit reviewers are deliberately off: check what the pre-commit runs before
re-enabling it.

Done when a commit in the main checkout visibly runs .husky/pre-commit.
