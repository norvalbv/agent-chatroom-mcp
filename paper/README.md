# Reading and reproducing the evidence

Start with the [2026-09-20 amendments](amendments.md#2026-09-20-0800-utc--provider-quota-hit-mid-block-the-thinking-regime-is-the-subscription-account-maintainer)
and the [five-arm pre-registration](prereg-confirmatory.md). The pre-registered primary
comparisons are essentially unobserved: the recorded run mostly used the long-thinking
account. Long-stratum tests are exploratory, and the account association does not identify
the underlying serving mechanism. This is not evidence that the arms are equivalent.

The checkout may contain an incomplete experiment snapshot. Use the report's missing-cell,
warning and stratum fields below, rather than importing counts from a later room transcript.
The manuscript's older A/C/K results and the five-arm run are separate analyses. Keep their
seed ranges and inference scopes distinct when rebuilding the manuscript.

## Reproduce the five-arm snapshot without running agents

Run from a clean checkout of the published commit, after installing the project's Node
dependencies. The commands scan the current working tree; they do not isolate a revision.
Do not use a checkout with uncommitted or untracked result cells. From that repository root:

```sh
evidence_dir="$(mktemp -d)"
node --import tsx scripts/paper-account-regime.ts --mixed-seeds \
  bench/results/account-switch-log/switches.json bench/results/rq1-confirmatory 4 \
  > "$evidence_dir/mixed-seeds.json"
node --import tsx scripts/paper-rq1-confirmatory.ts bench/results/rq1-confirmatory \
  --mixed-seeds "$evidence_dir/mixed-seeds.json" --out "$evidence_dir/confirmatory"
printf 'Report and structured data: %s\n' "$evidence_dir"
```

These commands read results and the sanitized switch log from that checkout; they launch no model
calls and write only to a temporary directory. Account slot `4` is the observed long-thinking
account in this dataset, not a general account identifier. Recompute mixed seeds whenever
results change: an incomplete seed may become mixed when its remaining cells arrive.

Inspect `confirmatory.md` and `confirmatory.json`: `missing` lists absent cells, `warnings`
lists unreadable provenance, and `cells`, `sentinels` and `runs` preserve the strata and
observations. A zero exit code means the report ran, not that the experiment is complete.
The mixed-seed list removes cross-regime seeds from within-regime comparisons; remaining
strata use the arm-A thinking sentinel, which cannot itself exclude a later regime change.
The printf seed-501 cap deviation and quota-invalidated cells are recorded separately in
[amendments.md](amendments.md); the report's main results directory is not a ledger of all
excluded attempts or their total spend.

## Building the manuscript

Original paper integration: `integration/swarm-164742-5jvl-verifier` at `1f221d9`.
The window-control refresh was built from source commit `e0e8912`, using completed control
artifacts committed in `c82124d`. That historical build is not a freshness guarantee for the
checked-in PDF; rebuild `main.tex` to render the current manuscript source.

## What was installed (user-local, per the room brief; nothing system-wide)

- `brew install tectonic` (0.17.0) — a self-contained LaTeX engine that fetches its own
  package tree on first run (needs network access once; cached under `~/Library/Caches/Tectonic`
  afterward). No system TeX distribution was installed.
- `pip3 install --user --break-system-packages matplotlib` (3.11.2) — `--break-system-packages`
  was required on this machine's Homebrew Python (PEP 668 externally-managed-environment guard);
  no other flag or system package was touched.

## Build

From `paper/`:

```
tectonic main.tex
```

produces `paper/main.pdf`. Tectonic runs LaTeX + BibTeX + xdvipdfmx passes automatically; no
separate `bibtex`/`pdflatex` invocation is needed.

## Regenerating tables and figures

The manuscript includes generated tables and figures from `paper/tables/*.tex` and
`paper/figures/*.png`, produced by scripts under `scripts/paper-*.ts` (Node, run with
`node --import tsx`) or `scripts/paper-fig.py` (matplotlib) reading committed results.
[regen-manifest.sh](regen-manifest.sh) lists the actual generators and inputs, including
the original suite, arm-K results, account-regime analysis and the incomplete five-arm
snapshot. The temporary-directory command above remains the safest way to inspect that
snapshot without modifying generated paper files. `scripts/paper-number-audit.ts` additionally
scans the rendered sections for numbers that don't trace back to a generated table/figure. To
regenerate everything and diff against what's committed:

```
bash paper/regen.sh
```

This exits non-zero if any regenerated table/figure differs from what `main.tex` currently
includes, per the room's "no hand-typed numbers" contract (`paper/figures.md`).

## Citation check

```
bash paper/check-citations.sh
```

Requires network access to `export.arxiv.org`. Scans every `paper/*.md` file for arXiv links/ids
and verifies each resolves and, where a title is given alongside it, that the title matches
arXiv's own record; separately scans `paper/refs.bib` and verifies every entry's `eprint` field
resolves and matches that entry's `title` field. Exit 0 only if every citation found (in the docs
and in the bibliography actually used by `main.tex`) checks out.
