"""Unbiased pass@k (oracle-selected) over the stored arm-K attempts: evidence/oracle-at-k, swarm-232020-hdju.
Run from the repo root: python3 scripts/oracle-at-k.py"""
import json, glob
from math import comb
from collections import defaultdict
T = defaultdict(list)
for f in glob.glob('bench/results/rq1-arm-k/*/result.json'):
    d = json.load(open(f))
    T[d['task_id']].append(([a['passed'] for a in d['attempts']], [a.get('cost_usd') or 0 for a in d['attempts']], d['passed']))
for t, rs in sorted(T.items()):
    n = len(rs)
    pa = sum(sum(p) for p, _, _ in rs) / sum(len(p) for p, _, _ in rs)
    mc = sum(sum(c) for _, c, _ in rs) / sum(len(c) for _, c, _ in rs)
    line = f"{t}: groups={n} per-attempt pass={pa:.3f} mean$/attempt={mc:.3f} K-selector={sum(s for *_, s in rs)}/{n}"
    for k in (1, 2, 3, 5, 7):
        v = sum(1 - comb(len(p) - sum(p), k) / comb(len(p), k) for p, _, _ in rs)
        line += f" | oracle@{k}={v:.1f}/{n}"
    print(line)
