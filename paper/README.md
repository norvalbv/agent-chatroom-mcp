# Building the paper

Original paper integration: `integration/swarm-164742-5jvl-verifier` at `1f221d9`.
The current `main.pdf` includes the window-control refresh from source commit `e0e8912`, using
the completed control artifacts committed in `c82124d`. The refresh separates the long-output,
crossover, and short-output cohorts; it does not pool them or add the exploratory Arm B pilot.

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

Every number in `main.tex` is `\input`/`\includegraphics`'d from `paper/tables/*.tex` and
`paper/figures/*.png`, each produced by a script under `scripts/paper-*.ts` (Node, run with
`node --import tsx`) or `scripts/paper-fig.py` (matplotlib) reading only committed paths under
`bench/results/rq1-suite` and `bench/results/rq1-arm-k`. `scripts/paper-number-audit.ts` additionally
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
