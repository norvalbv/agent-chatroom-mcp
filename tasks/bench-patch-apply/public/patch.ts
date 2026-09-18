export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatchError';
  }
}

export function applyPatch(original: string, patch: string): string {
  throw new Error('not implemented');
}
