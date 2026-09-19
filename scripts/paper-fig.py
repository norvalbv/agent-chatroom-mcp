#!/usr/bin/env python3
"""Renders every figure in paper/figures.md from paper/generated/fig-data.json, which
scripts/paper-fig-data.ts writes from the committed bench/results/rq1-suite and
bench/results/rq1-arm-k run artifacts. This script performs no statistics of its own and
reads no bench/results path directly: every number it plots is already in fig-data.json,
so a figure cannot drift from the tables printed in the same paper.

Usage: python3 scripts/paper-fig.py [FIG_DATA_JSON] [OUT_DIR]
  Defaults: FIG_DATA_JSON=paper/generated/fig-data.json OUT_DIR=paper/figures
Requires: matplotlib (pip3 install --user matplotlib; see paper/README.md).
"""
import json
import os
import sys
from collections import defaultdict

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

TASK_ORDER = ["stamp-interpreter", "stamp-2", "bench-printf-format"]
TASK_LABEL = {"stamp-interpreter": "stamp-interpreter", "stamp-2": "stamp-2", "bench-printf-format": "printf-format"}
ARM_ORDER = ["A", "C", "K"]
ARM_LABEL = {"A": "A (single agent)", "C": "C (chatroom)", "K": "K (k independent + selection)"}
ARM_COLOR = {"A": "#7570b3", "C": "#1b9e77", "K": "#d95f02"}


def task_sort_key(task):
    return TASK_ORDER.index(task) if task in TASK_ORDER else len(TASK_ORDER)


def fig_pass_rate(data, out_dir):
    """Figure: pass rate by arm and task, with 95% Wilson intervals (paper/figures.md Table 2 / Figure)."""
    tasks = sorted({p["task"] for p in data["pass_rates"]}, key=task_sort_key)
    fig, ax = plt.subplots(figsize=(7, 4.2))
    width = 0.25
    x = range(len(tasks))
    for ai, arm in enumerate(ARM_ORDER):
        rates, lo_err, hi_err = [], [], []
        for t in tasks:
            row = next((p for p in data["pass_rates"] if p["task"] == t and p["arm"] == arm), None)
            if row is None or row["rate"] is None:
                rates.append(0.0)
                lo_err.append(0.0)
                hi_err.append(0.0)
                continue
            rates.append(row["rate"])
            lo_err.append(row["rate"] - row["ci_lo"])
            hi_err.append(row["ci_hi"] - row["rate"])
        offsets = [xi + (ai - 1) * width for xi in x]
        ax.bar(offsets, rates, width=width, label=ARM_LABEL[arm], color=ARM_COLOR[arm])
        ax.errorbar(offsets, rates, yerr=[lo_err, hi_err], fmt="none", ecolor="black", elinewidth=1, capsize=3)
    ax.set_xticks(list(x))
    ax.set_xticklabels([TASK_LABEL.get(t, t) for t in tasks])
    ax.set_ylabel("task success rate")
    ax.set_ylim(0, 1.05)
    ax.set_title("Pass rate by arm and task (95% Wilson interval)")
    ax.legend(loc="lower left", fontsize=8)
    fig.tight_layout()
    path = os.path.join(out_dir, "fig-pass-rate.png")
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return path


def fig_cost_per_correct(data, out_dir):
    """Figure: cost per correct answer by arm and task (log scale), the brief's minimum figure list.
    A cell with zero task_pass (cost_per_correct is None, never 0) is drawn as an annotated gap, not a
    bar at height 0, which would misread as "free"."""
    tasks = sorted({c["task"] for c in data["cost_per_correct"]}, key=task_sort_key)
    fig, ax = plt.subplots(figsize=(7, 4.2))
    width = 0.25
    x = range(len(tasks))
    for ai, arm in enumerate(ARM_ORDER):
        vals, undefined_x = [], []
        offsets = [xi + (ai - 1) * width for xi in x]
        for xi, t in zip(offsets, tasks):
            row = next((c for c in data["cost_per_correct"] if c["task"] == t and c["arm"] == arm), None)
            if row is None or row["cost_per_correct"] is None:
                vals.append(0.0)
                undefined_x.append(xi)
            else:
                vals.append(row["cost_per_correct"])
        ax.bar(offsets, vals, width=width, label=ARM_LABEL[arm], color=ARM_COLOR[arm])
        for xi in undefined_x:
            ax.annotate("undefined\n(no pass)", (xi, 0), textcoords="offset points", xytext=(0, 4), ha="center", fontsize=7, rotation=90)
    ax.set_xticks(list(x))
    ax.set_xticklabels([TASK_LABEL.get(t, t) for t in tasks])
    ax.set_yscale("log")
    ax.set_ylabel("cost per correct answer, USD (log scale)")
    ax.set_title("Cost per correct answer by arm and task")
    ax.legend(loc="upper left", fontsize=8)
    fig.tight_layout()
    path = os.path.join(out_dir, "fig-cost-per-correct.png")
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return path


def fig_cost_vs_accuracy(data, out_dir):
    """Figure: cost per correct answer (x, log scale) vs. pass rate (y), one point per (task, arm)."""
    fig, ax = plt.subplots(figsize=(7, 4.6))
    markers = {"stamp-interpreter": "o", "stamp-2": "s", "bench-printf-format": "^"}
    seen_arms = set()
    for row in data["cost_vs_accuracy"]:
        if row["cost_per_correct"] is None or row["rate"] is None:
            continue
        arm = row["arm"]
        label = ARM_LABEL[arm] if arm not in seen_arms else None
        seen_arms.add(arm)
        ax.scatter(
            row["cost_per_correct"], row["rate"],
            marker=markers.get(row["task"], "x"), color=ARM_COLOR.get(arm, "gray"),
            s=90, label=label, edgecolors="black", linewidths=0.5,
        )
    ax.set_xscale("log")
    ax.set_xlabel("cost per correct answer, USD (log scale)")
    ax.set_ylabel("task success rate")
    ax.set_ylim(-0.02, 1.05)
    ax.set_title("Cost vs. accuracy by arm and task")
    # Two legends: colour = arm, marker shape = task.
    arm_legend = ax.legend(loc="lower left", fontsize=8, title="arm")
    ax.add_artist(arm_legend)
    shape_handles = [
        plt.Line2D([0], [0], marker=markers[t], color="gray", linestyle="", markersize=8, label=TASK_LABEL[t])
        for t in TASK_ORDER
    ]
    ax.legend(handles=shape_handles, loc="upper right", fontsize=8, title="task")
    ax.add_artist(arm_legend)
    fig.tight_layout()
    path = os.path.join(out_dir, "fig-cost-vs-accuracy.png")
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return path


def fig_vote_mechanism(data, out_dir):
    """Figure: for each arm-K group, the winning answer's vote share vs. whether the group passed.
    This is the mechanism figure: on the interpreter family a higher winner_share tracks passing
    (the plurality is usually correct); on printf a higher winner_share tracks failing (the plurality
    is usually the modal wrong answer)."""
    tasks = sorted({g["task"] for g in data["armk_group_votes"]}, key=task_sort_key)
    fig, axes = plt.subplots(1, len(tasks), figsize=(4.2 * len(tasks), 4.2), sharey=True)
    if len(tasks) == 1:
        axes = [axes]
    for ax, task in zip(axes, tasks):
        rows = [g for g in data["armk_group_votes"] if g["task"] == task]
        passed = [g["winner_share"] for g in rows if g["passed"]]
        failed = [g["winner_share"] for g in rows if not g["passed"]]
        bins = [i / 10 for i in range(3, 11)]
        ax.hist([passed, failed], bins=bins, stacked=True, color=["#1b9e77", "#d95f02"], label=["group passed", "group failed"])
        mean_p = sum(passed) / len(passed) if passed else None
        mean_f = sum(failed) / len(failed) if failed else None
        subtitle = f"mean share: pass={mean_p:.2f} fail={mean_f:.2f}" if (mean_p is not None and mean_f is not None) else ""
        ax.set_title(f"{TASK_LABEL.get(task, task)}\n{subtitle}", fontsize=9)
        ax.set_xlabel("winning answer's vote share (max votes / k)")
    axes[0].set_ylabel("number of arm-K groups")
    axes[0].legend(loc="upper left", fontsize=8)
    fig.suptitle("Arm K mechanism: does agreement track correctness?", y=1.03)
    fig.tight_layout()
    path = os.path.join(out_dir, "fig-vote-mechanism.png")
    fig.savefig(path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return path


def main():
    fig_data_path = sys.argv[1] if len(sys.argv) > 1 else "paper/generated/fig-data.json"
    out_dir = sys.argv[2] if len(sys.argv) > 2 else "paper/figures"
    os.makedirs(out_dir, exist_ok=True)
    with open(fig_data_path) as f:
        data = json.load(f)
    if data.get("warnings"):
        print("WARNING: fig-data.json carries warnings from generation:", file=sys.stderr)
        for w in data["warnings"]:
            print(f"  - {w}", file=sys.stderr)
    written = [
        fig_pass_rate(data, out_dir),
        fig_cost_per_correct(data, out_dir),
        fig_cost_vs_accuracy(data, out_dir),
        fig_vote_mechanism(data, out_dir),
    ]
    for p in written:
        print(f"Wrote {p}")


if __name__ == "__main__":
    main()
