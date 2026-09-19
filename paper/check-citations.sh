#!/usr/bin/env bash
# Verifies every arXiv citation under paper/ actually resolves and that the
# title written beside it matches arXiv's own record.
#
# Three citation forms are recognised, anywhere in paper/*.md:
#   1. A markdown link whose text IS the title:
#        [Exact Paper Title](https://arxiv.org/abs/2306.05685)
#      -> the id must resolve AND the bracketed text must match the arXiv
#         title (case/whitespace/punctuation-insensitive substring match).
#   2. A markdown-table row whose link text is just the bare id, with the
#      real title in the NEXT pipe-delimited cell (this repo's own
#      related-work.md convention):
#        | [arXiv:2306.05685](https://arxiv.org/abs/2306.05685) | Judging LLM-as-a-Judge ... | ...
#      -> the id must resolve AND the next cell must match the arXiv title.
#   3. A bare id with no adjacent link/title:  arXiv:2306.05685 or arXiv:cs/9810005
#      -> the id only needs to resolve (used when citing a source already
#         vetted elsewhere, e.g. docs/research-index.md, without repeating
#         its title here).
#
# Both current-style ids (YYMM.NNNNN[v#]) and pre-2007 ids (archive/YYMMNNN,
# e.g. cs/9810005) are recognised.
#
# Exit 0 only if every citation found resolves, and every titled citation's
# title matches. Network access to export.arxiv.org is required.

set -u -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAPER_DIR="$SCRIPT_DIR"
API="https://export.arxiv.org/api/query?id_list="

# New-style: 2306.05685 (optionally vN). Old-style: cs/9810005, math.CO/0211123.
NEWID='[0-9]{4}\.[0-9]{4,5}(v[0-9]+)?'
OLDID='[a-zA-Z][a-zA-Z.-]*/[0-9]{7}(v[0-9]+)?'
ANYID="(${NEWID}|${OLDID})"

fail=0
checked=0
title_cache_dir="$(mktemp -d)"
trap 'rm -rf "$title_cache_dir"' EXIT

normalize() {
  # lowercase, strip everything but alnum/space, collapse whitespace
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9 ' ' ' | tr -s ' ' | sed -e 's/^ *//' -e 's/ *$//'
}

strip_version() {
  # 2306.05685v2 -> 2306.05685 ; cs/9810005v1 -> cs/9810005
  printf '%s' "$1" | sed -E 's/v[0-9]+$//'
}

# arXiv ids we accept as the "same id" as a bare id for the purpose of
# suppressing a redundant bare-id re-check on a line already handled as a
# titled citation.
id_cache_key() {
  printf '%s' "$1" | tr '/' '_'
}

fetch_title() {
  local id="$1"
  local xml
  xml="$(curl -sS --max-time 20 "${API}${id}")" || return 1
  # first <title> is the feed's own query title; the entry's title is the second
  printf '%s' "$xml" | grep -o '<title>[^<]*</title>' | sed -n '2p' | sed -e 's/^<title>//' -e 's/<\/title>$//' -e 's/[[:space:]]\+/ /g'
}

check_id() {
  local id="$1" claimed_title="$2" file="$3"
  local cache_file="$title_cache_dir/$(id_cache_key "$id")"
  local real_title

  if [[ -f "$cache_file" ]]; then
    real_title="$(cat "$cache_file")"
  else
    checked=$((checked + 1))
    real_title="$(fetch_title "$id")"
    if [[ -z "$real_title" ]]; then
      echo "FAIL [$file] arXiv:$id does not resolve (empty/error from export.arxiv.org)" >&2
      fail=1
      : > "$cache_file"  # cache the failure too, so we don't hammer the API on repeats
      return
    fi
    printf '%s' "$real_title" > "$cache_file"
  fi

  if [[ -z "$real_title" ]]; then
    # cached failure from an earlier occurrence of this id
    echo "FAIL [$file] arXiv:$id does not resolve (cached failure)" >&2
    fail=1
    return
  fi

  if [[ -n "$claimed_title" ]]; then
    local n_claimed n_real
    n_claimed="$(normalize "$claimed_title")"
    n_real="$(normalize "$real_title")"
    if [[ "$n_real" != *"$n_claimed"* && "$n_claimed" != *"$n_real"* ]]; then
      echo "FAIL [$file] arXiv:$id title mismatch:" >&2
      echo "  cited as: $claimed_title" >&2
      echo "  arXiv has: $real_title" >&2
      fail=1
      return
    fi
  fi
  echo "OK   [$file] arXiv:$id -> $real_title"
}

# Is $1 nothing but "arXiv:<id>" (whitespace-insensitive), i.e. a bare-id
# link label rather than an actual title?
is_bare_id_label() {
  local label_norm id_norm
  label_norm="$(normalize "$1")"
  id_norm="$(normalize "arxiv $2")"
  [[ "$label_norm" == "$id_norm" ]] || [[ "$label_norm" == "$(normalize "$2")" ]]
}

files=("$PAPER_DIR"/*.md)
if [[ ! -e "${files[0]}" ]]; then
  echo "No .md files under $PAPER_DIR yet; nothing to check." >&2
  exit 0
fi

for f in "${files[@]}"; do
  base="$(basename "$f")"
  line_ids_file="$(mktemp)"  # ids already resolved via a titled link on this file, one per line

  while IFS= read -r line; do
    [[ -z "$line" ]] && continue

    link="$(printf '%s' "$line" | grep -oE "\[[^]]+\]\(https?://arxiv\.org/abs/${ANYID}\)" | head -1)"
    [[ -z "$link" ]] && continue

    id="$(printf '%s' "$link" | grep -oE "https?://arxiv\.org/abs/${ANYID}" | grep -oE "${ANYID}$")"
    id="$(strip_version "$id")"
    [[ -z "$id" ]] && continue

    link_text="$(printf '%s' "$link" | sed -E 's/^\[([^]]+)\].*/\1/')"

    if is_bare_id_label "$link_text" "$id"; then
      # Table convention: title lives in the next pipe-delimited cell.
      if [[ "$line" == *"|"* ]]; then
        title="$(printf '%s' "$line" | awk -F'|' -v needle="$id" '
          { for (i = 1; i <= NF; i++) if (index($i, needle) > 0) { print $(i+1); exit } }
        ' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
      else
        title=""
      fi
      check_id "$id" "$title" "$base"
    else
      check_id "$id" "$link_text" "$base"
    fi
    echo "$id" >> "$line_ids_file"
  done < "$f"

  # Bare arXiv:ID mentions, excluding ids already handled as a titled link above.
  while IFS= read -r id; do
    [[ -z "$id" ]] && continue
    id="$(strip_version "$id")"
    if grep -qxF "$id" "$line_ids_file" 2>/dev/null; then
      continue
    fi
    check_id "$id" "" "$base"
  done < <(grep -oE "arXiv:${ANYID}" "$f" | sed -E 's/^arXiv://')

  rm -f "$line_ids_file"
done

# paper/refs.bib: every @<type>{...} entry's `eprint` field must resolve, and its `title`
# field must match arXiv's own title. Paragraph mode (awk RS="") splits on blank lines,
# which is safe here because every generated entry is blank-line-separated and
# brace-closed on its own line (no blank line appears inside an entry).
bibfile="$PAPER_DIR/refs.bib"
if [[ -f "$bibfile" ]]; then
  base="$(basename "$bibfile")"
  while IFS= read -r -d $'\x01' record; do
    [[ "$record" == "@"* ]] || continue
    id="$(printf '%s' "$record" | grep -oE 'eprint[[:space:]]*=[[:space:]]*\{[^}]+\}' | head -1 | sed -E -e 's/^eprint[[:space:]]*=[[:space:]]*\{//' -e 's/\}$//')"
    if [[ -z "$id" ]]; then
      echo "FAIL [$base] entry with no eprint field: $(printf '%s' "$record" | head -1)" >&2
      fail=1
      continue
    fi
    title="$(printf '%s' "$record" | grep -oE 'title[[:space:]]*=[[:space:]]*\{.*\}[,]?$' | head -1 | sed -E -e 's/^title[[:space:]]*=[[:space:]]*\{//' -e 's/\},?$//' -e 's/\}$//')"
    check_id "$id" "$title" "$base"
  done < <(awk 'BEGIN{RS="";ORS="\x01"} {print}' "$bibfile")
fi

echo "---"
echo "$checked unique arXiv id(s) checked, fail=$fail"
exit "$fail"
