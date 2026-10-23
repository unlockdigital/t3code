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
describe("Home activity", () => {
  it("lets completed threads leave Working while persistent commands keep running", () => {
    const thread = {
      ...completed(),
      runtime: { ...running().runtime, status: "completed" as const, activeRunId: null },
      pendingBackgroundTasks: [{ kind: "command" as const, taskId: "preview-server" }],
    };
    expect(buildHomeActivity([thread], now)[0]).toMatchObject({
      kind: "unread",
      label: "Unread",
      startedAt: start,
      completedAt: now,
    });
    expect(buildHomeActivity([{ ...thread, lastVisitedAt: now }], now)[0]).toMatchObject({
      kind: "done",
      label: "Done",
      completedAt: now,
    });
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
  });
  it.each(["subagent", "monitor", "background_task"] as const)(
    "keeps completion-holding %s work in Working",
    (kind) => {
      const thread = {
        ...completed(),
        pendingBackgroundTasks: [
          { kind: "command" as const, taskId: "preview-server" },
          { kind, taskId: "active-work" },
        ],
      };
      expect(buildHomeActivity([thread], now)[0]).toMatchObject({
        kind: "working",
        completedAt: null,
      });
    },
  );
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
