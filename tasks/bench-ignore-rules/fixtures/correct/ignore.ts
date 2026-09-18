type Rule = { negate: boolean; dirOnly: boolean; anchored: boolean; re: RegExp };

function toRegex(pattern: string): string {
  let out = '';
  let i = 0;
  if (pattern.startsWith('**/')) {
    out += '(?:.*/)?';
    i = 3;
  }
  while (i < pattern.length) {
    const rest = pattern.slice(i);
    if (rest === '/**') {
      out += '/.+';
      break;
    }
    if (rest.startsWith('/**/')) {
      out += '/(?:.*/)?';
      i += 4;
      continue;
    }
    const c = pattern[i];
    if (c === '*') {
      while (pattern[i] === '*') i++;
      out += '[^/]*';
      continue;
    }
    if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    i++;
  }
  return `^${out}$`;
}

function parse(rules: string): Rule[] {
  const parsed: Rule[] = [];
  for (const raw of rules.split('\n')) {
    let line = raw.replace(/ +$/, '');
    if (line === '' || line.startsWith('#')) continue;
    const negate = line.startsWith('!');
    if (negate) line = line.slice(1);
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    if (line === '') continue;
    parsed.push({ negate, dirOnly, anchored, re: new RegExp(toRegex(line)) });
  }
  return parsed;
}

function decide(parsed: Rule[], candidate: string, isDir: boolean): boolean {
  let ignored = false;
  const base = candidate.slice(candidate.lastIndexOf('/') + 1);
  for (const rule of parsed) {
    if (rule.dirOnly && !isDir) continue;
    if (rule.re.test(rule.anchored ? candidate : base)) ignored = !rule.negate;
  }
  return ignored;
}

export function isIgnored(rules: string, path: string): boolean {
  const parsed = parse(rules);
  const parts = path.split('/');
  for (let k = 1; k < parts.length; k++) {
    if (decide(parsed, parts.slice(0, k).join('/'), true)) return true;
  }
  return decide(parsed, path, false);
}
