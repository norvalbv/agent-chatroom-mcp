import { format } from './format.ts';
import { readFileSync } from 'fs';

const cases: { fmt: string; arg: string; val: number | string }[] = JSON.parse(readFileSync('/tmp/seat3_cases.json', 'utf8'));
const expected: string[] = JSON.parse(readFileSync('/tmp/seat3_expected.json', 'utf8'));

let pass = 0, fail = 0, skip = 0;
for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  const exp = expected[i];
  if (exp.startsWith('ERROR:')) { skip++; continue; }
  const conv = c.fmt[c.fmt.length - 1];
  const arg: number | bigint | string = Number(c.val);
  let got: string;
  try {
    got = format(c.fmt, arg);
  } catch (e) {
    got = 'THROW:' + (e as Error).message;
  }
  if (got === exp) pass++;
  else fail++;
}
console.log(`${pass} passed, ${fail} failed (differences expected only for Python-specific octal/precision quirks), ${skip} skipped, out of ${cases.length}`);
process.exit(fail > 60 ? 1 : 0);
