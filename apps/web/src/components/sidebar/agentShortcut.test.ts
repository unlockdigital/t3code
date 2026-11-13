import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { createAgentShortcutActions, saveAgentShortcut } from "./agentShortcut";

const old = {
  environmentId: EnvironmentId.make("old"),
  threadId: ThreadId.make("old"),
  name: "Old",
};
const next = {
  environmentId: EnvironmentId.make("new"),
  threadId: ThreadId.make("new"),
  name: "New",
};

it("revokes the old environment before replacing or clearing the shortcut without a settings snapshot", async () => {
  for (const replacement of [next, null]) {
    const events: string[] = [];
    await saveAgentShortcut(
      old,
      replacement,
      async (ref) => {
        events.push(`revoke:${ref.threadId}`);
      },
      async () => {
        events.push("save");
      },
    );
    expect(events).toEqual(["revoke:old", "save"]);
  }
});

it("retains the old shortcut when revocation fails and skips revocation for a rename", async () => {
  const save = vi.fn();
  await expect(
    saveAgentShortcut(
      old,
      next,
      async () => {
        throw new Error("offline");
      },
      save,
    ),
  ).rejects.toThrow("offline");
  expect(save).not.toHaveBeenCalled();
  const revoke = vi.fn();
  await saveAgentShortcut(old, { ...old, name: "Renamed" }, revoke, save);
  expect(revoke).not.toHaveBeenCalled();
  expect(save).toHaveBeenCalledOnce();
});

it.each([next, null])(
  "orders pending approval before replacement and blocks late grants",
  async (replacement) => {
    const actions = createAgentShortcutActions(old);
    let finishApproval!: () => void;
    let finishRevoke!: () => void;
    let finishSave!: () => void;
    let markRevokeStarted!: () => void;
    let markSaveStarted!: () => void;
    const revokeStarted = new Promise<void>((resolve) => {
      markRevokeStarted = resolve;
    });
    const saveStarted = new Promise<void>((resolve) => {
      markSaveStarted = resolve;
    });
    const approvalPending = new Promise<void>((resolve) => {
      finishApproval = resolve;
    });
    const revokePending = new Promise<void>((resolve) => {
      finishRevoke = resolve;
    });
    const savePending = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    let granted = false;
    const approval = actions.approval(old, async () => {
      await approvalPending;
      granted = true;
    });
    const duplicate = vi.fn();
    expect(await actions.approval(old, duplicate)).toBe(false);
    const save = actions.save(
      old,
      replacement,
      async () => {
        markRevokeStarted();
        await revokePending;
        granted = false;
      },
      async () => {
        markSaveStarted();
        await savePending;
      },
    );
    const lateGrant = vi.fn(async () => {
      granted = true;
    });
    expect(await actions.approval(old, lateGrant)).toBe(false);
    expect(await actions.save(old, replacement, vi.fn(), vi.fn())).toBe(false);
    finishApproval();
    await approval;
    await revokeStarted;
    expect(granted).toBe(true);
    expect(await actions.approval(old, lateGrant)).toBe(false);
    finishRevoke();
    await saveStarted;
    expect(granted).toBe(false);
    expect(await actions.approval(old, lateGrant)).toBe(false);
    finishSave();
    expect(await save).toBe(true);
    expect(await actions.approval(old, lateGrant)).toBe(false);
    expect(lateGrant).not.toHaveBeenCalled();
    expect(duplicate).not.toHaveBeenCalled();
    expect(granted).toBe(false);
  },
);

it("retains the old shortcut and permits retry when revocation fails", async () => {
  const actions = createAgentShortcutActions(old);
  const persist = vi.fn();
  await expect(
    actions.save(
      old,
      next,
      async () => {
        throw new Error("offline");
      },
      persist,
    ),
  ).rejects.toThrow("offline");
  expect(persist).not.toHaveBeenCalled();
  expect(await actions.approval(old, async () => {})).toBe(true);
});
