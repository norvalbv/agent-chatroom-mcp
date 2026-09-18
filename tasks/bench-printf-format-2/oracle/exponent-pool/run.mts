import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const cases = JSON.parse(readFileSync('/tmp/pf/pool.json', 'utf8')) as { fmt: string; args: { n: string }[]; expected: string }[];
const dec = (a: { n: string }) => (a.n === '-0' ? -0 : Number(a.n));
const results: Record<string, number[]> = {};
for (const ws of process.argv.slice(2)) {
  const { format } = await import(pathToFileURL(ws + '/format.ts').href + '?' + Math.random());
  const fails: number[] = [];
  cases.forEach((c, i) => { let ok = false; try { ok = format(c.fmt, ...c.args.map(dec)) === c.expected; } catch {} if (!ok) fails.push(i); });
  results[ws] = fails;
  console.log(ws, 'fails', fails.length, 'of', cases.length);
}
writeFileSync('/tmp/pf/fails.json', JSON.stringify(results));
