import { format } from './format.ts';

let failures = 0;
function check(actual: string, expected: string, label: string) {
  if (actual !== expected) {
    failures++;
    console.log(`FAIL ${label}: got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
  }
}

// rounding examples from README
check(format('%.0f', 0.5), '0', 'round 0.5');
check(format('%.0f', 1.5), '2', 'round 1.5');
check(format('%.0f', 2.5), '2', 'round 2.5');
check(format('%.2f', 0.125), '0.12', 'round 0.125');
check(format('%.2f', 2.675), '2.67', 'round 2.675');

// -0
check(format('%f', -0), '-0.000000', 'neg zero f');

// d/i
check(format('%d', 42), '42', 'basic d');
check(format('%5d', 42), '   42', 'width d');
check(format('%-5d|', 42), '42   |', 'left d');
check(format('%05d', 42), '00042', 'zero pad d');
check(format('%+d', 42), '+42', 'plus d');
check(format('% d', 42), ' 42', 'space d');
check(format('%d', -42), '-42', 'neg d');
check(format('%.5d', 42), '00042', 'prec d');
check(format('%.0d', 0), '', 'prec0 zero d');
check(format('%.0d', 0) === '' ? 'ok' : 'no', 'ok', 'sanity');

// x X o
check(format('%x', 255), 'ff', 'hex');
check(format('%X', 255), 'FF', 'HEX');
check(format('%#x', 255), '0xff', 'hash hex');
check(format('%#x', 0), '0', 'hash hex zero');
check(format('%o', 8), '10', 'octal');
check(format('%#o', 8), '010', 'hash octal');
check(format('%#o', 0), '0', 'hash octal zero prec default');
check(format('%#.0o', 0), '0', 'hash octal zero prec0');

// e E
check(format('%e', 0), '0.000000e+00', 'e zero');
check(format('%e', 12345.6789), '1.234568e+04', 'e basic');
check(format('%.2e', 9999), '1.00e+04', 'e carry');
check(format('%E', 12345.6789), '1.234568E+04', 'E basic');

// f
check(format('%f', 3.14), '3.140000', 'f default prec');
check(format('%.2f', 3.14159), '3.14', 'f prec');

// g G
check(format('%g', 100000), '100000', 'g plain');
check(format('%g', 1000000), '1e+06', 'g sci');
check(format('%g', 0.0001), '0.0001', 'g small');
check(format('%g', 0.00001), '1e-05', 'g smaller');
check(format('%.3g', 0.0001234), '0.000123', 'g prec');
check(format('%#g', 1.5), '1.50000', 'g hash');

// s c
check(format('%s', 'hello'), 'hello', 's basic');
check(format('%.3s', 'hello'), 'hel', 's prec');
check(format('%10s|', 'hi'), '        hi|', 's width');
check(format('%-10s|', 'hi'), 'hi        |', 's left width');
check(format('%c', 'a'), 'a', 'c basic');

// %%
check(format('100%%'), '100%', 'literal percent');

// bigint
check(format('%d', 123n), '123', 'bigint d');
check(format('%d', -123n), '-123', 'bigint neg');

// infinities/nan
check(format('%f', Infinity), 'inf', 'inf f');
check(format('%f', -Infinity), '-inf', 'neg inf f');
check(format('%f', NaN), 'nan', 'nan f');
check(format('%F', NaN), 'NAN', 'NAN F');
check(format('%08.2f', Infinity), '     inf', 'inf zero pad ignored');
check(format('%+f', Infinity), '+inf', 'inf plus');

if (failures === 0) console.log('ALL PASS');
else console.log(`${failures} FAILURES`);

// more edge cases
check(format('%06.2f', -3.1), '-03.10', 'neg zero pad f');
check(format('%-06.2f|', -3.1), '-3.10 |', 'neg zero pad left ignored');
check(format('%.0e', 5), '5e+00', 'e prec0 no hash');
check(format('%#.0e', 5), '5.e+00', 'e prec0 hash');
check(format('%x', 255n), 'ff', 'bigint hex');
check(format('%.3o', 8), '010', 'o prec');
check(format('%05x', 255), '000ff', 'zero pad x precision none');
check(format('%05.3x', 255), '  0ff', 'zero pad ignored with precision x');
check(format('%g', 123456789), '1.23457e+08', 'g big');
check(format('%g', -0.0), '-0', 'g neg zero');
check(format('%.10f', 1e-10), '0.0000000001', 'f tiny');
check(format('%d', Number.MAX_SAFE_INTEGER), '9007199254740991', 'max safe int');
console.log(failures === 0 ? 'ALL PASS 2' : `${failures} still failing`);

check(format('%d', 0), '0', 'zero d default');
check(format('%#x', 0), '0', 'hash x zero no prefix');
check(format('%#.5o', 8), '00010', 'hash o precision already leading zero not doubled');
check(format('%+e', -1.5), '-1.500000e+00', 'neg e plus flag irrelevant');
check(format('%#.3g', 100), '100.', 'g hash no strip');
check(format('%.3g', 100), '100', 'g no hash strip trailing dot removed... actually 100 has no dot');
check(format('%g', 100), '100', 'g plain int');
check(format('%.1g', 9.5), '1e+01', 'g rounding carry to exp');
check(format('%s', ''), '', 'empty string');
check(format('%5.0s|', 'hello'), '     |', 's prec0');
console.log(failures === 0 ? 'ALL PASS 3' : `${failures} still failing total`);

// address challenge: s/c/%%/bigint coverage + g # flag trailing-zero edge cases
check(format('%%'), '%', 'lone percent');
check(format('%c%c%c', 'a', 'b', 'c'), 'abc', 'multi c');
check(format('%-5c|', 'x'), 'x    |', 'c left width');
check(format('%5c|', 'x'), '    x|', 'c right width');
check(format('%s%s', 'foo', 'bar'), 'foobar', 'adjacent s');
check(format('%d%s%d', 1n, 'mid', 2n), '1mid2', 'mixed bigint and string');
check(format('%d', 9007199254740993n), '9007199254740993', 'bigint beyond safe int');
check(format('%#.3g', 100.5), '100.', '# g no strip trailing zero kept, dot kept');
check(format('%#.3g', 100), '100.', '# g plain int keeps dot');
check(format('%.3g', 100.500), '100', 'g strips trailing frac digits and dot region (100.5 rounds P=3 -> X=2,P>X -> f prec0 -> "100" no dot since precision0 no hash');
check(format('%#g', 0), '0.00000', '# g zero keeps zeros');
check(format('%g', 0), '0', 'g zero strips to bare 0');
console.log(failures === 0 ? 'ALL PASS 4' : `${failures} still failing total (4)`);
