export function shellSplit(input: string): string[] {
  const words: string[] = [];
  let current = '';
  let inWord = false;
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      if (inWord) {
        words.push(current);
        current = '';
        inWord = false;
      }
      i++;
    } else if (c === "'") {
      const end = input.indexOf("'", i + 1);
      if (end === -1) throw new Error('unterminated single quote');
      current += input.slice(i + 1, end);
      inWord = true;
      i = end + 1;
    } else if (c === '"') {
      i++;
      for (;;) {
        if (i >= input.length) throw new Error('unterminated double quote');
        const d = input[i];
        if (d === '"') {
          i++;
          break;
        }
        if (d === '\\' && i + 1 < input.length && (input[i + 1] === '"' || input[i + 1] === '\\')) {
          current += input[i + 1];
          i += 2;
        } else {
          current += d;
          i++;
        }
      }
      inWord = true;
    } else if (c === '\\') {
      if (i + 1 >= input.length) throw new Error('trailing backslash');
      current += input[i + 1];
      inWord = true;
      i += 2;
    } else {
      current += c;
      inWord = true;
      i++;
    }
  }
  if (inWord) words.push(current);
  return words;
}
