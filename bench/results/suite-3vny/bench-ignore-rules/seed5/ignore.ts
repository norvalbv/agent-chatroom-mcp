function globToRegex(p: string): RegExp {
  let out = '';
  let i = 0;
  while (i < p.length) {
    const c = p[i];
    if (c === '*') {
      let j = i;
      while (j < p.length && p[j] === '*') j++;
      const len = j - i;
      const atStart = i === 0;
      const prevSlash = i > 0 && p[i - 1] === '/';
      const atEnd = j === p.length;
      const nextSlash = !atEnd && p[j] === '/';
      if (len === 2 && atStart && nextSlash) {
        out += '(?:.*/)?';
        j++;
      } else if (len === 2 && prevSlash && nextSlash) {
        out += '(?:.*/)?';
        j++;
      } else if (len === 2 && prevSlash && atEnd) {
        out += '.+';
      } else {
        out += '[^/]*';
      }
      i = j;
      continue;
    }
    if (c === '?') out += '[^/]';
    else out += c.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
    i++;
  }
  return new RegExp('^' + out + '$');
}

interface Rule {
  neg: boolean;
  dirOnly: boolean;
  anchored: boolean;
  re: RegExp;
}

export function isIgnored(rules: string, path: string): boolean {
  const parsed: Rule[] = [];
  for (let line of rules.split('\n')) {
    line = line.replace(/ +$/, '');
    if (line === '' || line[0] === '#') continue;
    let neg = false;
    if (line[0] === '!') {
      neg = true;
      line = line.slice(1);
    }
    let dirOnly = false;
    if (line.endsWith('/')) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    const anchored = line.includes('/');
    if (anchored && line[0] === '/') line = line.slice(1);
    if (line === '') continue;
    parsed.push({ neg, dirOnly, anchored, re: globToRegex(line) });
  }

  const parts = path.split('/');
  const decide = (cand: string, isDir: boolean): boolean => {
    const name = cand.slice(cand.lastIndexOf('/') + 1);
    let result = false;
    for (const r of parsed) {
      if (r.dirOnly && !isDir) continue;
      if (r.re.test(r.anchored ? cand : name)) result = !r.neg;
    }
    return result;
  };

  for (let k = 1; k < parts.length; k++) {
    if (decide(parts.slice(0, k).join('/'), true)) return true;
  }
  return decide(path, false);
}
