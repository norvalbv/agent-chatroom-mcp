export function wrapText(s: string, width: number): string {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line === '') line = word;
    else if (line.length + word.length > width) {
      lines.push(line);
      line = word;
    } else line += ' ' + word;
  }
  if (line !== '') lines.push(line);
  return lines.join('\n');
}
