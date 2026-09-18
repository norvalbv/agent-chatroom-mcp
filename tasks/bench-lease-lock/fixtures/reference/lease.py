import sys
from collections import deque

class Res:
    def __init__(self):
        self.holder = None
        self.deadline = None
        self.q = deque()

def release(res, tick):
    res.holder = None
    res.deadline = None
    if res.q:
        who, ln = res.q.popleft()
        res.holder, res.deadline = who, tick + ln

def main(path):
    rs = {f"R{i}": Res() for i in range(1, 6)}
    for raw in open(path):
        raw = raw.strip()
        if not raw or raw.startswith('#'):
            continue
        f = raw.split()
        tick, c, act, name = int(f[0]), f[1], f[2], f[3]
        n = int(f[4]) if len(f) > 4 else None
        r = rs[name]
        if r.holder is not None and r.deadline <= tick:
            release(r, tick)
        if act == 'LOCK':
            if r.holder is None:
                r.holder, r.deadline = c, tick + n
            elif r.holder != c and all(w != c for w, _ in r.q):
                r.q.append((c, n))
        elif act == 'UNLOCK':
            if r.holder == c:
                release(r, tick)
        elif act == 'RENEW':
            if r.holder == c:
                r.deadline = tick + n
    parts = []
    for i in range(1, 6):
        r = rs[f"R{i}"]
        st = 'free' if r.holder is None else f"{r.holder}@{r.deadline}"
        parts.append(f"R{i}:{st}[{','.join(w for w, _ in r.q)}]")
    print(' '.join(parts))

main(sys.argv[1])
