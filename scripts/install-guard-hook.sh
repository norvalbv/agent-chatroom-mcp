#!/bin/sh
# Installs a guard-only pre-commit hook (owner's choice, 2026-09-24): git runs only the baseline-freeze guard
# (scripts/guard-baseline-freeze.mjs, docs/decisions/done-means-independently-verified.md rule 3), not the
# devkit-owned block in .husky/pre-commit, because devkit reviewers are deliberately off. It writes husky's
# hooks directory, .husky/_ (which core.hooksPath already names), and never runs git config. `npm run prepare`
# regenerates .husky/_ as husky's full stubs; rerun this script afterwards to get back to guard-only.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
dir="$root/.husky/_"
mkdir -p "$dir"
printf '*\n' > "$dir/.gitignore"
cat > "$dir/pre-commit" <<'HOOK'
#!/bin/sh
# Guard-only pre-commit (scripts/install-guard-hook.sh): the baseline-freeze guard, nothing else.
exec node scripts/guard-baseline-freeze.mjs
HOOK
chmod +x "$dir/pre-commit"
echo "installed guard-only pre-commit in .husky/_ (core.hooksPath: $(git -C "$root" rev-parse --git-path hooks))"
