# Building the paper

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
`paper/figures/*.pdf`, each produced by a script under `scripts/paper-*.ts` (Node, run with
`node --import tsx`) or `scripts/paper-*.py` (matplotlib) reading only committed paths under
`bench/results/` and `swarms/`. To regenerate everything and diff against what's committed:

```
bash paper/regen.sh
```

This exits non-zero if any regenerated table/figure differs from what `main.tex` currently
includes, per the room's "no hand-typed numbers" contract (`paper/figures.md`).

## Citation check

```
bash paper/check-citations.sh
```

Requires network access to `export.arxiv.org`; scans every `paper/*.md` file (not `.tex`) for
arXiv links/ids and verifies each resolves and, where a title is given alongside it, that the
title matches arXiv's own record. `refs.bib` entries are additionally cross-checked by
`scripts/paper-check-refs-bib.ts` (every `\cite`-able key in `refs.bib` must carry an
`arxiv = {...}` field whose id appears, resolved, in this same check).
