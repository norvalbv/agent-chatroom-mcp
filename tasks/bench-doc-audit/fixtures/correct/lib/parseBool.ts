export function parseBool(s: string): boolean | undefined {
  const v = s.trim().toLowerCase();
  if (v === 'true' || v === 'yes' || v === '1' || v === 'on') return true;
  if (v === 'false' || v === 'no' || v === '0' || v === 'off') return false;
  return undefined;
}
