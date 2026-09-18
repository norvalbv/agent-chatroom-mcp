interface Rule {
  negate: boolean;
  dirOnly: boolean;
  anchored: boolean;
  re: RegExp;
}

function globToRegex(p: string): RegExp {
  let out = '';
  let i = 0;
  while (i < p.length) {
    if (i === 0 && p.startsWith('**/')) {
      out += '(?:.*/)?';
      i += 3;
    } else if (p.startsWith('/**/', i)) {
      out += '/(?:.*/)?';
      i += 4;
    } else if (i + 3 === p.length && p.startsWith('/**', i)) {
      out += '/.+';
      i += 3;
    } else if (p[i] === '*') {
      while (p[i] === '*') i++;
      out += '[^/]*';
    } else if (p[i] === '?') {
      out += '[^/]';
      i++;
    } else {
      out += p[i].replace(/[\\^$.*+?()[\]{}|\/-]/g, '\\$&');
      i++;
    }
  }
  return new RegExp('^' + out + '$');
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
    if (anchored && line.startsWith('/')) line = line.slice(1);
    if (line === '') continue;
    result.push({ negate, dirOnly, anchored, re: globToRegex(line) });
  }
  return result;
}

export function isIgnored(rules: string, path: string): boolean {
  const parsed = parse(rules);
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

  for (let i = 1; i < parts.length; i++) {
    if (decide(parts.slice(0, i).join('/'), true)) return true;
  }
  return decide(path, false);
}
