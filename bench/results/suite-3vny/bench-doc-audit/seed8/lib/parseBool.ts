export function parseBool(s: string): boolean | undefined {
  const v = s.trim().toLowerCase();
  if (v === 'true' || v === 'yes' || v === 'on' || v === '1') return true;
  if (v === 'false' || v === 'no' || v === 'off' || v === '0') return false;
  return undefined;
}
