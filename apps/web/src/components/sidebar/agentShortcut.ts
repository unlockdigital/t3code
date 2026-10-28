import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";

type Shortcut = ScopedThreadRef & { readonly name: string };

export async function saveAgentShortcut(
  previous: Shortcut | null,
  next: Shortcut | null,
  revoke: (ref: ScopedThreadRef) => Promise<void>,
  save: (next: Shortcut | null) => Promise<void>,
): Promise<void> {
  if (previous && (!next || scopedThreadKey(previous) !== scopedThreadKey(next))) {
    await revoke(previous);
  }
  await save(next);
}

export function createAgentShortcutActions(initial: Shortcut | null) {
  let current = initial;
  let saving = false;
  let pendingApproval: Promise<void> | null = null;
  const matches = (ref: ScopedThreadRef | null) =>
    ref === null
      ? current === null
      : current !== null && scopedThreadKey(ref) === scopedThreadKey(current);

  return {
    isSaving: () => saving,
    syncShortcut: (shortcut: Shortcut | null) => {
      current = shortcut;
    },
    async approval(ref: ScopedThreadRef, update: () => Promise<void>): Promise<boolean> {
      if (saving || pendingApproval || !matches(ref)) return false;
      const pending = Promise.resolve().then(update);
      pendingApproval = pending;
      try {
        await pending;
        return true;
      } finally {
        pendingApproval = null;
      }
    },
    async save(
      previous: Shortcut | null,
      next: Shortcut | null,
      revoke: (ref: ScopedThreadRef) => Promise<void>,
      persist: (next: Shortcut | null) => Promise<void>,
    ): Promise<boolean> {
      if (saving || !matches(previous)) return false;
      saving = true;
      try {
        // Even a failed approval update must settle before the final revocation.
        await pendingApproval?.catch(() => {});
        await saveAgentShortcut(previous, next, revoke, persist);
        current = next;
        return true;
      } finally {
        saving = false;
      }
    },
  };
}
