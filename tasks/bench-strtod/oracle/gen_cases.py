"""Generates oracle/cases.json and oracle/expected.json for bench-strtod.
Expected values come from Python (float / float.fromhex) with the prefix grammar of README.md, and are cross-checked
against the real libc strtod through ctypes; a case libc disagrees with is dropped (and counted).
Run: python3 gen_cases.py   (deterministic: seeded)
"""
import ctypes, ctypes.util, json, math, random, re, struct, sys
random.seed(20260918)
libc = ctypes.CDLL(ctypes.util.find_library('c'))
libc.strtod.restype = ctypes.c_double
libc.strtod.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_char_p)]
WS = ' \t\n\v\f\r'
HEX = re.compile(r'0[xX](?:[0-9a-fA-F]+(?:\.[0-9a-fA-F]*)?|\.[0-9a-fA-F]+)(?:[pP][+-]?[0-9]+)?')
DEC = re.compile(r'(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?')
INF = re.compile(r'(?i:infinity|inf)')
NAN = re.compile(r'(?i:nan)(?:\([A-Za-z0-9_]*\))?')
def bits(v):
    return 'nan' if math.isnan(v) else struct.pack('>d', v).hex()
def spec(s):
    i = 0
    while i < len(s) and s[i] in WS: i += 1
    neg = False
    if i < len(s) and s[i] in '+-':
        neg = s[i] == '-'; i += 1
    rest = s[i:]
    for kind, rx in (('hex', HEX), ('inf', INF), ('nan', NAN), ('dec', DEC)):
        m = rx.match(rest)
        if m:
            t = m.group(0)
            if kind == 'hex':
                try: v = float.fromhex(t)
                except OverflowError: v = math.inf
            elif kind == 'inf': v = math.inf
            elif kind == 'nan': v = math.nan
            else: v = float(t)
            if neg: v = -v
            return bits(v), i + len(t)
    return bits(0.0), 0
def libc_strtod(s):
    b = s.encode('latin-1')
    e = ctypes.c_char_p()
    buf = ctypes.create_string_buffer(b)
    v = libc.strtod(buf, ctypes.byref(e))
    end = ctypes.cast(e, ctypes.c_void_p).value - ctypes.addressof(buf)
    return bits(v), end
cases = []
def add(s): cases.append(s)
# curated grammar cases
for s in ['', ' ', '+', '-', '.', '-.', '+.', '.e5', 'e5', 'abc', ' \t\n\v\f\r7', '\x0b\x0c 3.5', '\x1f5', '\x00'[:0] + '5', '+5', '-5', '+-5', '- 5', '--5', '5 ', '5x', '5.', '5..', '5.5.5', '.5', '-.5', '+.5e1', '5e', '5e+', '5e-', '5e+x', '5e3', '5E3', '5e+3', '5e-3', '5e3.5', '1e5000', '-1e5000', '1e-5000', '-1e-5000', '0e999999999999', '0.0', '-0', '-0.0', '-0e5', '0x', '0X', '0x ', '0xg', '0x.', '0x.p1', '0x1', '0X1', '0x.8', '0x1.', '0x1.8', '0x1p', '0x1p+', '0x1p-', '0x1p3', '0x1P3', '0x1p+3', '0x1p-3', '0x1.8p3', '0x1.8p3z', '0x.8p1', '0xa.bp2', '0xABC.DEFp-4', '-0x1p3', '+0x1p3', '- 0x1p3', '0x0', '-0x0', '0x0p10000', '0x1p1024', '0x1p-1074', '0x1p-1075', '0x1.8p-1075', '0x1.0000000000001p-1075', '0x1p-1076', '0xffffffffffffffff', '0x10000000000000000', '0x1.fffffffffffffp1023', '0x1.fffffffffffff8p1023', '0x1.fffffffffffff7ffffp1023', '0x1p99999999999', '0x1p-99999999999', '0x1p+999999999999999999999',
          'inf', 'INF', 'Inf', 'infinity', 'INFINITY', 'infinit', 'infinityx', 'infx', 'in', '-inf', '+inf', '-infinity', '- inf', 'nan', 'NaN', 'NAN', '-nan', '+nan', 'nan(', 'nan()', 'nan(abc)', 'nan(a_1)', 'nan(a b)', 'nan(a-b)', 'nan(abc', 'nanx', 'nan(abc)x', 'na', 'n',
          '4.9e-324', '2.4703282292062327e-324', '2.4703282292062328e-324', '2.4703282292062327208e-324', '2.4703282292062327209e-324', '2.2250738585072011e-308', '2.2250738585072014e-308', '1.7976931348623157e308', '1.7976931348623158e308', '1.7976931348623159e308', '1.797693134862315807e308', '9007199254740993', '9007199254740992.5', '9007199254740993.0000000000000000001', '0.1', '0.2', '0.3', '123456789012345678901234567890', '0.000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
          '5e2 ', '5\x00'[:1], '1_000', '1,5', '1e1e1', '0x1p1p1', '0x1.2.3', '0x1e1', '0x1e+1', '0x1p1.5']:
    add(s)
def rdig(n): return ''.join(random.choice('0123456789') for _ in range(n))
def rhex(n): return ''.join(random.choice('0123456789abcdefABCDEF') for _ in range(n))
for _ in range(70):
    a = rdig(random.randint(0, 25)); b = rdig(random.randint(0, 25))
    if not a and not b: a = '7'
    s = a + ('.' + b if random.random() < .7 else '')
    if random.random() < .5: s += random.choice('eE') + random.choice(['', '+', '-']) + str(random.randint(0, 400))
    if random.random() < .3: s = random.choice(['+', '-']) + s
    if random.random() < .2: s = random.choice([' ', '\t', '  \n']) + s
    if random.random() < .2: s += random.choice(['x', ' ', 'e', 'e+', '.', 'f'])
    add(s)
# hex random, many with >53 significant bits and denormal / overflow exponents
for _ in range(210):
    a = rhex(random.randint(0, 22)); b = rhex(random.randint(0, 22))
    if not a and not b: a = '1'
    s = '0' + random.choice('xX') + a + ('.' + b if random.random() < .8 else '')
    r = random.random()
    if r < .55: s += random.choice('pP') + random.choice(['', '+', '-']) + str(random.choice([random.randint(0, 40), random.randint(900, 1100), random.randint(1000, 1100), random.randint(1040, 1200)]))
    elif r < .7: s += random.choice('pP')
    if random.random() < .25: s = random.choice(['+', '-']) + s
    if random.random() < .1: s = ' ' + s
    if random.random() < .15: s += random.choice(['x', 'g', ' ', 'p', '.'])
    add(s)
# exact ties and near-ties at the 53-bit boundary, in normal and denormal range
for _ in range(60):
    m = random.getrandbits(52) | (1 << 52)          # 53-bit significand
    tie = (m << 1 | 1)                                 # 54 bits: exact halfway between m and m+1
    k = random.choice([0, 0, 1, -3, 970, -1022 - 52, -1022 - 53, -1074 + 1, 1023 - 54 + 1])
    delta = random.choice([0, 0, 1, -1])
    v = (tie << 8) + delta if delta else (tie << 8)
    add('0x%x' % v + 'p' + str(k - 9))
    add('0x%x.%sp%d' % (m, '8' + '0' * random.randint(0, 6) + random.choice(['', '0', '1']), k))
print('cases', len(cases), file=sys.stderr)
out_cases, expected, dropped = [], [], 0
seen = set()
for s in cases:
    if s in seen: continue
    seen.add(s)
    if '\x00' in s: continue
    e = spec(s)
    l = libc_strtod(s)
    if e != l:
        dropped += 1
        print('DISAGREE', repr(s), 'spec', e, 'libc', l, file=sys.stderr)
        continue
    out_cases.append(s); expected.append({'bits': e[0], 'end': e[1]})
json.dump(out_cases, open('cases.json', 'w'))
json.dump(expected, open('expected.json', 'w'))
print('kept', len(out_cases), 'dropped', dropped, file=sys.stderr)
