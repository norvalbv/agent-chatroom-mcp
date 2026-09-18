function toRegex(p: string): RegExp {
  let out = '';
  let i = 0;
  if (p.startsWith('**/')) {
    out += '(?:.*/)?';
    i = 3;
  }
  while (i < p.length) {
    const c = p[i];
    if (c === '/') {
      if (p.startsWith('/**/', i)) {
        out += '/(?:.*/)?';
        i += 4;
        continue;
      }
      if (p.slice(i) === '/**') {
        out += '/.+';
        break;
      }
      out += '/';
      i++;
    } else if (c === '*') {
      while (p[i] === '*') i++;
      out += '[^/]*';
    } else if (c === '?') {
      out += '[^/]';
      i++;
    } else {
      out += c.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
      i++;
    }
  }
  return new RegExp('^' + out + '$');
}

interface Rule {
  negate: boolean;
  dirOnly: boolean;
  anchored: boolean;
  re: RegExp;
}

export function isIgnored(rules: string, path: string): boolean {
  const parsed: Rule[] = [];
  for (let line of rules.split('\n')) {
    line = line.replace(/ +$/, '');
    if (line === '' || line.startsWith('#')) continue;
    let negate = false;
    if (line.startsWith('!')) {
      negate = true;
      line = line.slice(1);
    }
    let dirOnly = false;
    if (line.endsWith('/')) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    if (line === '') continue;
    const anchored = line.includes('/');
    if (anchored && line.startsWith('/')) line = line.slice(1);
    parsed.push({ negate, dirOnly, anchored, re: toRegex(line) });
  }

  const parts = path.split('/');
  const decide = (cand: string, isDir: boolean): boolean => {
    const name = cand.slice(cand.lastIndexOf('/') + 1);
    let result = false;
    for (const r of parsed) {
      if (r.dirOnly && !isDir) continue;
      if (r.re.test(r.anchored ? cand : name)) result = !r.negate;
    }
    return result;
  };

  for (let n = 1; n < parts.length; n++) {
    if (decide(parts.slice(0, n).join('/'), true)) return true;
  }
  return decide(path, false);
}
