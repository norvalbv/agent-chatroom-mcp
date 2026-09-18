# Hidden generator + exact reference for half-round. Stdlib only; deterministic.
import random, struct, sys
from fractions import Fraction

def enc16(x, neg=None):
    sign = 0x8000 if (x < 0 if neg is None else neg) else 0
    ax = abs(x)
    if ax == 0:
        return sign
    def rhe(q):
        f = q.numerator // q.denominator
        r = q - f
        if r > Fraction(1, 2) or (r == Fraction(1, 2) and f % 2 == 1):
            f += 1
        return f
    e = ax.numerator.bit_length() - ax.denominator.bit_length()
    while Fraction(2) ** e > ax: e -= 1
    while Fraction(2) ** (e + 1) <= ax: e += 1
    if e < -14:
        m = rhe(ax / Fraction(2) ** -24)
        return sign | m
    m = rhe(ax / Fraction(2) ** (e - 10))
    if m == 2048:
        e += 1; m = 1024
    if e > 15:
        return sign | 0x7c00
    return sign | ((e + 15) << 10) | (m - 1024)

def parse(s):
    s = s.strip(); neg = s.startswith('-')
    if s[0] in '+-': s = s[1:]
    mant, _, exp = s.lower().partition('e')
    ip, _, fp = mant.partition('.')
    v = Fraction(int(ip + fp or '0'), 10 ** len(fp)) * Fraction(10) ** int(exp or 0)
    return -v if neg else v

def naive(s):  # the double-rounding shortcut a seat would write
    f = float(s)
    try:
        return struct.unpack('<H', struct.pack('<e', f))[0]
    except OverflowError:
        return 0xfc00 if f < 0 else 0x7c00

def half_values():
    return [struct.unpack('<e', struct.pack('<H', b))[0] for b in range(0, 0x7c00)]

def dec(fr, digits):
    # decimal expansion of a positive dyadic fraction, exact
    n, d = fr.numerator, fr.denominator
    ip, rem = divmod(n, d); out = str(ip)
    if rem:
        out += '.'
        while rem:
            rem *= 10; dgt, rem = divmod(rem, d); out += str(dgt)
    return out

def build():
    R = random.Random(20260918)
    items = []
    # A: plain decimals
    for _ in range(50):
        k = R.choice([1, 2, 3, 4, 5, 6])
        v = R.randint(1, 10 ** k) / 10 ** R.randint(0, k)
        items.append(repr(v) if 'e' not in repr(v) else '%.6f' % v)
    # B: exact midpoints between adjacent finite half values (ties to even), all dyadic so exact decimal
    mids = []
    for _ in range(40):
        b = R.randint(1, 0x7bfe)
        lo = Fraction(struct.unpack('<e', struct.pack('<H', b))[0]); hi = Fraction(struct.unpack('<e', struct.pack('<H', b + 1))[0])
        mids.append((lo + hi) / 2)
    for m in mids:
        items.append(('-' if R.random() < .2 else '') + dec(m, 0))
    # C: adversarial near-midpoints: midpoint with a far-away digit appended so that float(s) collapses to the midpoint
    cand = []
    for _ in range(400):
        b = R.randint(1, 0x7bfe)
        lo = Fraction(struct.unpack('<e', struct.pack('<H', b))[0]); hi = Fraction(struct.unpack('<e', struct.pack('<H', b + 1))[0])
        m = (lo + hi) / 2
        base = dec(m, 0)
        for tail in ('0000000000000000000001', '9999999999999999999999'):
            if tail.startswith('9'):
                # just below midpoint: subtract 1e-(len) by writing digits of m - tiny
                tiny = Fraction(1, 10 ** (len(base.split('.')[-1]) + 18 if '.' in base else 20))
                s = dec(m - tiny, 0)
            else:
                s = base + ('' if '.' in base else '.') + tail if '.' in base else base + '.' + tail
            cand.append(s)
    diff = [s for s in cand if naive(s) != enc16(parse(s), s.strip().startswith('-'))]
    R.shuffle(diff)
    items += diff[:60]
    # D: subnormal region
    q = Fraction(1, 2 ** 24)
    for k in range(1, 12):
        items.append(dec(q * k, 0)); items.append(dec(q * k + q / 2, 0)); items.append(dec(q * k + q / 2 + Fraction(1, 10 ** 30), 0))
    items += ['1e-8', '3e-8', '2.98023223876953125e-8', '2.9802322387695313e-8', '6.1e-5', '6.103515625e-5', '6.1035156249e-5', '0.00006097555']
    # E: overflow edge
    items += ['65504', '65519.99999999999999', '65520', '65520.00000000001', '65535', '6.5519999e4', '1e5', '131008', '65505', '65519']
    # F: zeros and negatives
    items += ['0', '-0', '-0.0', '0.000', '-1e-9', '-65520', '-65519.9999', '+0.5', '-0.5', '1e0']
    R.shuffle(items)
    return items

if __name__ == '__main__':
    items = build()
    exp = [format(enc16(parse(s), s.strip().startswith('-')), '04x') for s in items]
    if len(sys.argv) > 1 and sys.argv[1] == 'stats':
        print(len(items), 'inputs;', sum(1 for s in items if naive(s) != enc16(parse(s), s.strip().startswith('-'))), 'double-rounding differs')
    else:
        open('tasks/half-round/public/inputs.txt', 'w').write('\n'.join(items) + '\n')
        open('/tmp/half_exp.txt', 'w').write(' '.join(exp))
        print(len(items))
