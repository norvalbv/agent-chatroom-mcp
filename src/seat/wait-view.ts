/** A locally absorbed full view must survive an unchanged response before the model sees it. */
export function retainWaitView(previous: string, next: string): string {
  try {
    const before = JSON.parse(previous);
    const after = JSON.parse(next);
    if (after?.unchanged !== true || !before || typeof before !== "object" || Array.isArray(before)) return next;
    const merged = { ...before, ...after };
    if (before.unchanged !== true) delete merged.unchanged;
    if (Array.isArray(before.messages)) merged.messages = [...before.messages, ...(after.messages ?? [])];
    const oldProposal = before.open_proposal, reference = after.open_proposal;
    if (reference?.unchanged === true && oldProposal?.id === reference.id && oldProposal?.version === reference.version) merged.open_proposal = oldProposal;
    return JSON.stringify(merged);
  } catch { return next; }
}
