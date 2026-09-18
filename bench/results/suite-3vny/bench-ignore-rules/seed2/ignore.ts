function compile(pat: string): RegExp {
  let re = '';
  let i = 0;
  while (i < pat.length) {
    const c = pat[i];
    if (c === '*') {
      let j = i;
      while (j < pat.length && pat[j] === '*') j++;
      const n = j - i;
      const prevSlash = i === 0 || pat[i - 1] === '/';
      if (n === 2 && prevSlash && j < pat.length && pat[j] === '/') {
        re += '(?:.*/)?';
        i = j + 1;
        continue;
      }
      if (n === 2 && i > 0 && pat[i - 1] === '/' && j === pat.length) {
        re += '.+';
        i = j;
        continue;
      }
      re += '[^/]*';
      i = j;
      continue;
    }
    if (c === '?') re += '[^/]';
    else re += c.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
    i++;
  }
  return new RegExp('^' + re + '$', 's');
}

export function isIgnored(rules: string, path: string): boolean {
  const parsed: { neg: boolean; dirOnly: boolean; anchored: boolean; re: RegExp }[] = [];
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
    parsed.push({ neg, dirOnly, anchored, re: compile(line) });
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
