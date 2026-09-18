import sys, re
def tok(s): return s.replace('(', ' ( ').replace(')', ' ) ').split()
def parse(t, i):
    if t[i] == '(':
        i += 1; items = []
        while t[i] != ')':
            e, i = parse(t, i); items.append(e)
        return ('form', items), i + 1
    if re.fullmatch(r'-?\d+', t[i]): return ('int', int(t[i])), i + 1
    return ('name', t[i]), i + 1
def run(src):
    out, funcs, glob, counters = [], {}, {}, [0] * 10
    depth = [0]
    def ev(e, env):
        k = e[0]
        if k == 'int': return e[1]
        if k == 'name': return env[e[1]] if e[1] in env else glob[e[1]]
        op = e[1][0][1]
        vals = [ev(a, env) for a in e[1][1:]]
        if op == '+': return vals[0] + vals[1]
        if op == '-': return vals[0] - vals[1]
        if op == '*': return vals[0] * vals[1]
        if op == '<': return int(vals[0] < vals[1])
        if op == '=': return int(vals[0] == vals[1])
        if op == 'and': return int(vals[0] != 0 and vals[1] != 0)
        if op == 'or': return int(vals[0] != 0 or vals[1] != 0)
        if op == 'not': return int(vals[0] == 0)
        if op == 'if': return vals[1] if vals[0] != 0 else vals[2]
        if op == 'seq': return vals[1]
        if op == 'out': out.append(vals[0]); return vals[0]
        if op == 'bump': counters[vals[0]] += 1; return counters[vals[0]]
        if op == 'peek': return counters[vals[0]]
        ps, body = funcs[op]
        if depth[0] + 1 > 5: return 0
        depth[0] += 1
        try: return ev(body, dict(zip(ps, vals)))
        finally: depth[0] -= 1
    for line in src.split('\n'):
        line = line.strip()
        if not line or line.startswith('#'): continue
        m = re.match(r'^(LET|DEF|SHOW)\s+(.*)$', line)
        head, rest = m.group(1), m.group(2)
        if head == 'SHOW':
            e, _ = parse(tok(rest), 0); out.append(ev(e, {}))
        elif head == 'LET':
            n, r = rest.split('=', 1); e, _ = parse(tok(r), 0); glob[n.strip()] = ev(e, {})
        else:
            l, r = rest.split('=', 1); t = l.split(); e, _ = parse(tok(r), 0); funcs[t[0]] = (t[1:], e)
    return out
if __name__ == '__main__':
    print(' '.join(str(x) for x in run(open(sys.argv[1]).read())))
