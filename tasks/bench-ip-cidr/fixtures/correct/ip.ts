function parseGroups(text: string): number[] {
  if (!/^[0-9a-fA-F:]+$/.test(text)) throw new Error('invalid IPv6 address');
  const halves = text.split('::');
  if (halves.length > 2) throw new Error('invalid IPv6 address');
  const parse = (part: string): number[] => {
    if (part === '') return [];
    return part.split(':').map((g) => {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) throw new Error('invalid IPv6 address');
      return parseInt(g, 16);
    });
  };
  const head = parse(halves[0]);
  if (halves.length === 1) {
    if (head.length !== 8) throw new Error('invalid IPv6 address');
    return head;
  }
  const tail = parse(halves[1]);
  const missing = 8 - head.length - tail.length;
  if (missing < 1) throw new Error('invalid IPv6 address');
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function compress(groups: number[]): string {
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestLen < 2) return hex.join(':');
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLen).join(':')}`;
}

const toBig = (groups: number[]) => groups.reduce((acc, g) => (acc << 16n) | BigInt(g), 0n);
const fromBig = (n: bigint) => Array.from({ length: 8 }, (_, i) => Number((n >> BigInt(16 * (7 - i))) & 0xffffn));

export function normalizeIPv6(text: string): string {
  return compress(parseGroups(text));
}

export function expandIPv6(text: string): string {
  return parseGroups(text).map((g) => g.toString(16).padStart(4, '0')).join(':');
}

function parseCidr(cidr: string): { base: bigint; prefix: number } {
  const slash = cidr.indexOf('/');
  if (slash === -1 || cidr.indexOf('/', slash + 1) !== -1) throw new Error('invalid CIDR');
  const prefixText = cidr.slice(slash + 1);
  if (!/^(0|[1-9][0-9]{0,2})$/.test(prefixText)) throw new Error('invalid CIDR');
  const prefix = Number(prefixText);
  if (prefix > 128) throw new Error('invalid CIDR');
  return { base: toBig(parseGroups(cidr.slice(0, slash))), prefix };
}

export function cidrRange(cidr: string): { first: string; last: string } {
  const { base, prefix } = parseCidr(cidr);
  const hostBits = BigInt(128 - prefix);
  const mask = ((1n << 128n) - 1n) ^ ((1n << hostBits) - 1n);
  const first = base & mask;
  const last = first | ((1n << hostBits) - 1n);
  return { first: compress(fromBig(first)), last: compress(fromBig(last)) };
}

export function cidrContains(cidr: string, ip: string): boolean {
  const { base, prefix } = parseCidr(cidr);
  const address = toBig(parseGroups(ip));
  const shift = BigInt(128 - prefix);
  return base >> shift === address >> shift;
}
