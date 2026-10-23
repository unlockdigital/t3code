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
describe("Home activity", () => {
  it("shows active and unsettled work while excluding settled and archived history", () => {
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
      kind: "review",
      label: "Done",
      startedAt: start,
      completedAt: now,
    });
  });
  it("honors explicitly settled failures and leaves untimed drafts ready", () => {
    const failed = {
      ...running(),
      runtime: { ...running().runtime, status: "failed" as const },
      settledOverride: "settled" as const,
    };
    const draft = { ...root(), id: ThreadId.make("draft") };
    const rows = buildHomeActivity([failed, draft], now);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: "Ready", startedAt: null });
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
