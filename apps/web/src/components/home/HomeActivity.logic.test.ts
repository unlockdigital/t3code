import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId, RunId } from "@t3tools/contracts";
import { makeThreadFixture } from "../../test-fixtures";
import { buildHomeActivity } from "./HomeActivity.logic";
const now = "2026-10-23T12:00:00.000Z";
const start = "2026-10-23T11:47:00.000Z";
const root = () => makeThreadFixture({ id: ThreadId.make("root"), runtime: null, latestRun: null });
const running = () => {
  const thread = root();
  const runId = RunId.make("run");
  return {
    ...thread,
    runtime: {
      status: "running" as const,
      activeRunId: runId,
      providerInstanceId: thread.providerInstanceId,
      providerName: "Codex",
      lastError: null,
      updatedAt: now,
    },
    latestRun: {
      runId,
      status: "running" as const,
      requestedAt: start,
      startedAt: start,
      completedAt: null,
      assistantMessageId: null,
    },
  };
};
const completed = () => {
  const thread = running();
  return {
    ...thread,
    runtime: null,
    latestRun: { ...thread.latestRun, status: "completed" as const, completedAt: now },
  };
};
const limited = () => {
  const thread = completed();
  return {
    ...thread,
    runtime: {
      ...running().runtime,
      status: "failed" as const,
      activeRunId: null,
      lastErrorClass: "usage_limit" as const,
    },
    latestRun: { ...thread.latestRun, status: "failed" as const },
  };
};
describe("Home activity", () => {
  it("keeps an old child failure from masking a parent waiting for new agents", () => {
    const parent = {
      ...completed(),
      lastVisitedAt: now,
      latestRun: {
        ...completed().latestRun,
        requestedAt: "2026-10-23T11:55:00.000Z",
        startedAt: "2026-10-23T11:55:00.000Z",
      },
      runtime: { ...running().runtime, status: "idle" as const, activeRunId: null },
      pendingBackgroundTasks: [
        { kind: "subagent" as const, taskId: "new-review", childThreadId: ThreadId.make("review") },
      ],
    };
    const oldFailure = {
      ...limited(),
      id: ThreadId.make("old-failure"),
      latestRun: { ...limited().latestRun, completedAt: start },
      lineage: {
        rootThreadId: parent.id,
        parentThreadId: parent.id,
        relationshipToParent: "subagent" as const,
      },
    };
    const reviewer = { ...running(), id: ThreadId.make("review"), lineage: oldFailure.lineage };
    expect(buildHomeActivity([parent, oldFailure, reviewer], now)[0]).toMatchObject({
      kind: "working",
      label: "Waiting for agents",
    });
    expect(
      buildHomeActivity([{ ...parent, lastVisitedAt: null }, oldFailure, reviewer], now)[0]?.kind,
    ).toBe("working");
  });
  it("acknowledges child failures when either the child or its parent has been read", () => {
    const parent = completed();
    const child = {
      ...limited(),
      id: ThreadId.make("failed-child"),
      lineage: {
        rootThreadId: parent.id,
        parentThreadId: parent.id,
        relationshipToParent: "subagent" as const,
      },
    };
    expect(buildHomeActivity([parent, { ...child, lastVisitedAt: now }], now)[0]?.kind).toBe(
      "unread",
    );
    expect(buildHomeActivity([{ ...parent, lastVisitedAt: now }, child], now)[0]?.kind).toBe(
      "done",
    );
    expect(
      buildHomeActivity(
        [
          { ...parent, lastVisitedAt: now },
          { ...child, hasPendingApprovals: true },
        ],
        now,
      )[0]?.label,
    ).toBe("Approval needed");
  });
  it("keeps new failures visible after an earlier parent visit", () => {
    const parent = { ...running(), lastVisitedAt: start };
    const child = {
      ...limited(),
      id: ThreadId.make("failed-child"),
      lastVisitedAt: start,
      lineage: {
        rootThreadId: parent.id,
        parentThreadId: parent.id,
        relationshipToParent: "subagent" as const,
      },
    };
    expect(buildHomeActivity([parent, child], now)[0]).toMatchObject({
      kind: "attention",
      label: "Usage limit",
    });
  });
  it("hides an acknowledged usage limit while the thread is snoozed", () => {
    const thread = {
      ...limited(),
      lastVisitedAt: now,
      snoozedAt: now,
      snoozedUntil: "2026-10-24T12:00:00.000Z",
    };
    expect(buildHomeActivity([thread], now)).toEqual([]);
  });
  it("keeps a snoozed child usage limit out of its parent's attention status", () => {
    const parent = { ...completed(), lastVisitedAt: now };
    const child = {
      ...limited(),
      id: ThreadId.make("limited-child"),
      lastVisitedAt: now,
      snoozedAt: now,
      snoozedUntil: "2026-10-24T12:00:00.000Z",
      lineage: {
        rootThreadId: parent.id,
        parentThreadId: parent.id,
        relationshipToParent: "subagent" as const,
      },
    };
    expect(buildHomeActivity([parent, child], now)[0]).toMatchObject({
      kind: "done",
      label: "Done",
    });
    expect(buildHomeActivity([running(), child], now)[0]).toMatchObject({
      kind: "working",
      label: "Working",
    });
    const freshFailure = { ...child, snoozedAt: start, lastVisitedAt: start };
    expect(
      buildHomeActivity([{ ...parent, lastVisitedAt: start }, freshFailure], now)[0],
    ).toMatchObject({
      kind: "attention",
      label: "Usage limit",
    });
    const expired = { ...child, snoozedUntil: now };
    expect(buildHomeActivity([parent, expired], now)[0]?.kind).toBe("done");
  });
  it("honors a parent snooze for old child failures and surfaces new requests", () => {
    const parent = {
      ...completed(),
      lastVisitedAt: start,
      snoozedAt: now,
      snoozedUntil: "2026-10-24T12:00:00.000Z",
    };
    const child = {
      ...limited(),
      id: ThreadId.make("limited-child"),
      lineage: {
        rootThreadId: parent.id,
        parentThreadId: parent.id,
        relationshipToParent: "subagent" as const,
      },
    };
    expect(buildHomeActivity([parent, child], now)).toEqual([]);
    expect(buildHomeActivity([{ ...parent, snoozedAt: start }, child], now)[0]).toMatchObject({
      kind: "attention",
      label: "Usage limit",
    });
    expect(
      buildHomeActivity([parent, { ...child, hasPendingApprovals: true }], now)[0],
    ).toMatchObject({ kind: "attention", label: "Approval needed" });
  });
  it.each([
    { kind: "command", awaited: undefined },
    { kind: "monitor", awaited: undefined },
  ] as const)(
    "shows completed $kind work with awaited=$awaited as Unread or Done after a visit",
    ({ kind, awaited }) => {
      const thread = {
        ...completed(),
        runtime: { ...running().runtime, status: "completed" as const, activeRunId: null },
        pendingBackgroundTasks: [
          { kind, taskId: "persistent-work", ...(awaited === undefined ? {} : { awaited }) },
        ],
      };
      expect(buildHomeActivity([thread], now)[0]).toMatchObject({
        kind: "unread",
        unread: true,
        label: "Unread",
        startedAt: start,
        completedAt: now,
      });
      expect(buildHomeActivity([{ ...thread, lastVisitedAt: now }], now)[0]).toMatchObject({
        kind: "done",
        unread: false,
        label: "Done",
        completedAt: now,
      });
      expect(
        buildHomeActivity([{ ...thread, lastVisitedAt: now, hasPendingApprovals: true }], now)[0],
      ).toMatchObject({ kind: "attention", label: "Approval needed" });
      const parent = completed();
      const child = {
        ...thread,
        id: ThreadId.make("child"),
        lineage: {
          rootThreadId: parent.id,
          parentThreadId: parent.id,
          relationshipToParent: "subagent" as const,
        },
      };
      expect(buildHomeActivity([parent, child], now)[0]?.kind).toBe("unread");
      expect(buildHomeActivity([{ ...parent, lastVisitedAt: now }, child], now)[0]?.kind).toBe(
        "done",
      );
      expect(buildHomeActivity([{ ...parent, settledOverride: "settled" }, child], now)).toEqual(
        [],
      );
      expect(buildHomeActivity([{ ...thread, settledOverride: "settled" }], now)).toEqual([]);
    },
  );
  it.each([
    { kind: "command", awaited: true },
    { kind: "monitor", awaited: true },
    { kind: "subagent", awaited: undefined },
    { kind: "background_task", awaited: undefined },
  ] as const)(
    "keeps completed $kind work with awaited=$awaited in Working",
    ({ kind, awaited }) => {
      const thread = {
        ...completed(),
        lastVisitedAt: now,
        pendingBackgroundTasks: [
          { kind: "command" as const, taskId: "preview-server" },
          { kind, taskId: "active-work", ...(awaited === undefined ? {} : { awaited }) },
        ],
      };
      expect(buildHomeActivity([thread], now)[0]).toMatchObject({
        kind: "working",
        completedAt: null,
      });
      expect(buildHomeActivity([{ ...thread, hasPendingApprovals: true }], now)[0]).toMatchObject({
        kind: "attention",
        label: "Approval needed",
      });
      expect(buildHomeActivity([{ ...thread, settledOverride: "settled" }], now)).toEqual([]);
    },
  );
  it("keeps a completed parent Working while a child runs and surfaces its approval", () => {
    const parent = { ...completed(), lastVisitedAt: now };
    const child = {
      ...running(),
      id: ThreadId.make("active-child"),
      lineage: {
        rootThreadId: parent.id,
        parentThreadId: parent.id,
        relationshipToParent: "subagent" as const,
      },
    };
    expect(buildHomeActivity([parent, child], now)[0]).toMatchObject({
      kind: "working",
      label: "Waiting for agents",
      completedAt: null,
    });
    expect(
      buildHomeActivity([parent, { ...child, hasPendingApprovals: true }], now)[0],
    ).toMatchObject({ kind: "attention", label: "Approval needed" });
    expect(buildHomeActivity([{ ...parent, settledOverride: "settled" }, child], now)).toEqual([]);
  });
  it("separates unopened completions from read, resting threads", () => {
    const unread = completed();
    const done = {
      ...completed(),
      id: ThreadId.make("done"),
      lastVisitedAt: now,
    };
    const rows = buildHomeActivity([done, unread], now);
    expect(rows.map(({ kind, unread, label }) => ({ kind, unread, label }))).toEqual([
      { kind: "unread", unread: true, label: "Unread" },
      { kind: "done", unread: false, label: "Done" },
    ]);
  });
  it("moves completed work between unread and done as the visit watermark changes", () => {
    const thread = completed();
    const read = { ...thread, lastVisitedAt: now };
    expect(buildHomeActivity([read], now)[0]?.kind).toBe("done");
    const markedUnread = { ...read, lastVisitedAt: start };
    expect(buildHomeActivity([markedUnread], now)[0]?.kind).toBe("unread");
    expect(buildHomeActivity([{ ...markedUnread, lastVisitedAt: now }], now)[0]?.kind).toBe("done");
  });
  it("honors server visits over local watermarks and scopes legacy visits by environment", () => {
    const { lastVisitedAt: _lastVisitedAt, ...thread } = completed();
    const visits = { [`${thread.environmentId}:${thread.id}`]: now };
    expect(buildHomeActivity([thread], now, visits)[0]?.kind).toBe("done");
    const remote = { ...thread, environmentId: EnvironmentId.make("remote") };
    expect(buildHomeActivity([remote], now, visits)[0]?.kind).toBe("unread");
    expect(buildHomeActivity([{ ...thread, lastVisitedAt: start }], now, visits)[0]?.kind).toBe(
      "unread",
    );
  });
  it("keeps active work and attention ahead of unread completions", () => {
    const working = { ...running(), id: ThreadId.make("working") };
    const attention = { ...completed(), id: ThreadId.make("attention"), hasPendingApprovals: true };
    expect(
      buildHomeActivity([completed(), working, attention], now).map((row) => row.kind),
    ).toEqual(["attention", "working", "unread"]);
  });
  it("hides snoozed and deleted completions while keeping active work visible", () => {
    const snoozed = {
      ...completed(),
      snoozedAt: now,
      snoozedUntil: "2026-10-24T12:00:00.000Z",
    };
    const deleted = { ...completed(), id: ThreadId.make("deleted"), deletedAt: now };
    expect(buildHomeActivity([snoozed, deleted], now)).toEqual([]);
    expect(
      buildHomeActivity([{ ...running(), snoozedUntil: snoozed.snoozedUntil }], now)[0]?.kind,
    ).toBe("working");
  });
  it("leaves drafts and invalid completion timestamps in done without an unread marker", () => {
    const thread = completed();
    const invalid = { ...thread, latestRun: { ...thread.latestRun, completedAt: "invalid" } };
    expect(buildHomeActivity([invalid], now)[0]).toMatchObject({ kind: "done", unread: false });
    expect(buildHomeActivity([root()], now)[0]).toMatchObject({
      kind: "done",
      unread: false,
      label: "Ready",
    });
  });
  it("shows working threads while excluding settled and archived history", () => {
    const working = running();
    const settled = {
      ...root(),
      id: ThreadId.make("settled"),
      settledOverride: "settled" as const,
    };
    const archived = { ...root(), id: ThreadId.make("archived"), archivedAt: now };
    const rows = buildHomeActivity([working, settled, archived], now);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "working",
      label: "Working",
      startedAt: start,
      completedAt: null,
    });
  });
  it("groups child agents by environment and counts native agents without duplicates", () => {
    const parent = running();
    const child = {
      ...running(),
      id: ThreadId.make("child"),
      lineage: {
        rootThreadId: parent.id,
        parentThreadId: parent.id,
        relationshipToParent: "subagent" as const,
      },
    };
    const withTasks = {
      ...parent,
      pendingBackgroundTasks: [
        { kind: "subagent" as const, taskId: "linked", childThreadId: child.id },
        { kind: "subagent" as const, taskId: "native", description: "Inspecting tests" },
      ],
    };
    const remote = { ...child, environmentId: EnvironmentId.make("remote") };
    const rows = buildHomeActivity([withTasks, child, remote], now);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.thread.id === parent.id)).toMatchObject({
      agentCount: 3,
      nativeAgentCount: 1,
    });
    expect(rows.find((row) => row.thread.environmentId === remote.environmentId)?.thread.id).toBe(
      child.id,
    );
  });
  it("prioritizes a child approval and keeps completed durations fixed", () => {
    const parent = running();
    const done = {
      ...parent,
      id: ThreadId.make("done"),
      runtime: null,
      latestRun: { ...parent.latestRun, status: "completed" as const, completedAt: now },
    };
    const child = {
      ...running(),
      id: ThreadId.make("child"),
      hasPendingApprovals: true,
      lineage: {
        rootThreadId: parent.id,
        parentThreadId: parent.id,
        relationshipToParent: "subagent" as const,
      },
    };
    const rows = buildHomeActivity([done, parent, child], now);
    expect(rows[0]).toMatchObject({ kind: "attention", label: "Approval needed" });
    expect(rows[1]).toMatchObject({
      kind: "unread",
      label: "Unread",
      startedAt: start,
      completedAt: now,
    });
  });
  it("hides explicitly settled failures and leaves untimed drafts ready", () => {
    const failed = {
      ...running(),
      runtime: { ...running().runtime, status: "failed" as const },
      settledOverride: "settled" as const,
    };
    const draft = { ...root(), id: ThreadId.make("draft") };
    const rows = buildHomeActivity([failed, draft], now);
    expect(rows).toHaveLength(1);
    expect(rows.find((row) => row.thread.id === draft.id)).toMatchObject({
      label: "Ready",
      startedAt: null,
    });
  });
  it("hides settled unread, read, and active threads together with their agents", () => {
    const unread = { ...completed(), settledOverride: "settled" as const };
    const read = { ...unread, id: ThreadId.make("read"), lastVisitedAt: now };
    const working = {
      ...running(),
      id: ThreadId.make("working"),
      settledOverride: "settled" as const,
    };
    const child = {
      ...running(),
      id: ThreadId.make("child"),
      hasPendingApprovals: true,
      lineage: {
        rootThreadId: unread.id,
        parentThreadId: unread.id,
        relationshipToParent: "subagent" as const,
      },
    };
    expect(buildHomeActivity([unread, read, working, child], now)).toEqual([]);
    expect(buildHomeActivity([{ ...read, settledOverride: "active" }], now)[0]?.kind).toBe("done");
  });
  it("preserves orphaned agents and tolerates cyclic lineage", () => {
    const a = {
      ...running(),
      id: ThreadId.make("a"),
      lineage: {
        rootThreadId: ThreadId.make("a"),
        parentThreadId: ThreadId.make("b"),
        relationshipToParent: "subagent" as const,
      },
    };
    const b = { ...a, id: ThreadId.make("b"), lineage: { ...a.lineage, parentThreadId: a.id } };
    expect(buildHomeActivity([a], now)).toHaveLength(1);
    expect(buildHomeActivity([a, b], now)).toHaveLength(2);
  });
});
