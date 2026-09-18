interface Rule {
  negate: boolean;
  dirOnly: boolean;
  anchored: boolean;
  re: RegExp;
}

function globToRegex(p: string): string {
  let out = '';
  let i = 0;
  const n = p.length;
  if (p.startsWith('**/')) {
    out += '(?:.*/)?';
    i = 3;
  }
  while (i < n) {
    const c = p[i];
    if (c === '/' && p.startsWith('**/', i + 1)) {
      out += '/(?:.*/)?';
      i += 4;
      while (p.startsWith('**/', i)) i += 3;
      continue;
    }
    if (c === '/' && p.length - i === 3 && p.endsWith('/**')) {
      out += '/.+';
      i = n;
      continue;
    }
    if (c === '*') {
      while (i < n && p[i] === '*') i++;
      out += '[^/]*';
      continue;
    }
    if (c === '?') {
      out += '[^/]';
    } else {
      out += c.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
    }
    i++;
  }
  return out;
}

function parse(rules: string): Rule[] {
  const result: Rule[] = [];
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
    const anchored = line.includes('/');
    let src = globToRegex(line);
    if (anchored && line.startsWith('/')) src = src.slice(1);
    result.push({ negate, dirOnly, anchored, re: new RegExp('^' + src + '$') });
  }
  return result;
}

export function isIgnored(rules: string, path: string): boolean {
  const parsed = parse(rules);
  const parts = path.split('/');

  const decide = (candidate: string, isDir: boolean): boolean => {
    const name = candidate.slice(candidate.lastIndexOf('/') + 1);
    let result = false;
    for (const r of parsed) {
      if (r.dirOnly && !isDir) continue;
      if (r.re.test(r.anchored ? candidate : name)) result = !r.negate;
    }
    return result;
  };

  for (let k = 1; k < parts.length; k++) {
    if (decide(parts.slice(0, k).join('/'), true)) return true;
  }
  return decide(path, false);
}
