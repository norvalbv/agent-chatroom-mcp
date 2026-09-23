#!/usr/bin/env python3
"""Renders the review-practice figure from paper/generated/verify-practice.json and
paper/generated/review-audit.json (both written by committed generators from committed
records). It computes nothing beyond the shares it plots.

Usage: python3 scripts/paper-fig-review.py [GENERATED_DIR] [OUT_DIR]
Requires: matplotlib.
"""
import json
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

VERIFY_ORDER = ["existing_tests", "scripted_smoke", "inspection_only", "own_check", "app_in_browser", "agents_on_changed_build", "unclear"]
VERIFY_LABEL = {
    "existing_tests": "Build / existing tests",
    "scripted_smoke": "Scripted smoke client",
    "inspection_only": "Read code or docs only",
    "own_check": "Own probe or before/after",
    "app_in_browser": "App in a real browser",
    "agents_on_changed_build": "Agents on changed build",
    "unclear": "Not enough detail",
}
AUDIT_ORDER = ["reran_author_command", "read_diff_only", "own_independent_test", "exercised_real_behaviour", "provenance_check", "asserted_without_evidence"]
AUDIT_LABEL = {
    "reran_author_command": "Re-ran author's test/build",
    "read_diff_only": "Read the diff only",
    "own_independent_test": "Own check",
    "exercised_real_behaviour": "Used it as users would",
    "provenance_check": "Checked commit contents",
    "asserted_without_evidence": "No stated check",
}


def main():
    gen = sys.argv[1] if len(sys.argv) > 1 else "paper/generated"
    out = sys.argv[2] if len(sys.argv) > 2 else "paper/figures"
    v = json.load(open(os.path.join(gen, "verify-practice.json")))
    a = json.load(open(os.path.join(gen, "review-audit.json")))
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10, 3.8))

    counts = [v["classes"][k] for k in VERIFY_ORDER]
    y = range(len(VERIFY_ORDER))
    ax1.barh(y, counts, color="#7570b3")
    for i, c in enumerate(counts):
        ax1.text(c + 2, i, str(c), va="center", fontsize=8)
    ax1.set_yticks(list(y))
    ax1.set_yticklabels([VERIFY_LABEL[k] for k in VERIFY_ORDER], fontsize=8)
    ax1.invert_yaxis()
    ax1.set_xlabel("verify entries")
    ax1.set_title(f"(a) Strongest check in {v['heads']} verify entries", fontsize=9)
    ax1.set_xlim(0, max(counts) * 1.2)

    acts = [a["total"]["acts"][m] for m in AUDIT_ORDER]
    found = [a["total"]["defects"][m] for m in AUDIT_ORDER]
    y2 = range(len(AUDIT_ORDER))
    ax2.barh(y2, acts, color="#bdbdbd", label="review acts")
    ax2.barh(y2, found, color="#d95f02", label="found a defect")
    for i, (n, f) in enumerate(zip(acts, found)):
        ax2.text(n + 2, i, f"{f}/{n}", va="center", fontsize=8)
    ax2.set_yticks(list(y2))
    ax2.set_yticklabels([AUDIT_LABEL[m] for m in AUDIT_ORDER], fontsize=8)
    ax2.invert_yaxis()
    ax2.set_xlabel("review acts (four audited rooms)")
    ax2.set_title(f"(b) {a['total']['n']} review acts (first auditor)", fontsize=9)
    ax2.set_xlim(0, max(acts) * 1.25)
    ax2.legend(fontsize=7, loc="lower right")

    fig.tight_layout()
    os.makedirs(out, exist_ok=True)
    fig.savefig(os.path.join(out, "fig-review-practice.png"), dpi=150)


if __name__ == "__main__":
    main()
