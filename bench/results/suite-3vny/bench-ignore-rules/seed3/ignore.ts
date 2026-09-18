interface Rule {
  negate: boolean;
  dirOnly: boolean;
  anchored: boolean;
  re: RegExp;
}

function toRegex(p: string): RegExp {
  let out = '';
  let i = 0;
  while (i < p.length) {
    if (i === 0 && p.startsWith('**/')) {
      out += '(?:.*/)?';
      i += 3;
    } else if (p.startsWith('/**/', i)) {
      out += '/(?:.*/)?';
      i += 4;
    } else if (p.startsWith('/**', i) && i + 3 === p.length) {
      out += '/.+';
      i += 3;
    } else if (p[i] === '*') {
      while (p[i] === '*') i++;
      out += '[^/]*';
    } else if (p[i] === '?') {
      out += '[^/]';
      i++;
    } else {
      out += p[i].replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
      i++;
    }
  }
  return new RegExp('^' + out + '$');
}

function parse(rules: string): Rule[] {
  const result: Rule[] = [];
  for (let line of rules.split('\n')) {
    line = line.replace(/ +$/, '');
    if (line === '' || line[0] === '#') continue;
    let negate = false;
    if (line[0] === '!') {
      negate = true;
      line = line.slice(1);
    }
    let dirOnly = false;
    if (line.endsWith('/')) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    const anchored = line.includes('/');
    if (anchored && line[0] === '/') line = line.slice(1);
    result.push({ negate, dirOnly, anchored, re: toRegex(line) });
  }
  return result;
}

export function isIgnored(rules: string, path: string): boolean {
  const parsed = parse(rules);
  const parts = path.split('/');
  for (let n = 1; n <= parts.length; n++) {
    const isDir = n < parts.length;
    const full = parts.slice(0, n).join('/');
    const name = parts[n - 1];
    let ignored = false;
    for (const r of parsed) {
      if (r.dirOnly && !isDir) continue;
      if (r.re.test(r.anchored ? full : name)) ignored = !r.negate;
    }
    if (ignored) return true;
  }
  return false;
}
