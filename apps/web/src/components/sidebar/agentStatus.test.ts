import { describe, expect, it } from "vite-plus/test";
import { makeThreadFixture } from "../../test-fixtures";
import { resolveAgentStatus } from "./agentStatus";
import { ProviderInstanceId, RunId } from "@t3tools/contracts";

const runtime = {
  status: "running" as const,
  activeRunId: null,
  providerInstanceId: ProviderInstanceId.make("codex"),
  providerName: "Codex",
  lastError: null,
  updatedAt: "2026-10-24T10:00:00Z",
};
const latestRun = {
  runId: RunId.make("run-one"),
  status: "completed" as const,
  assistantMessageId: null,
  requestedAt: "2026-10-24T10:00:00Z",
  startedAt: "2026-10-24T10:00:00Z",
  completedAt: "2026-10-24T10:05:00Z",
};

describe("Teddy status", () => {
  it("prioritizes approvals and questions over ongoing work", () => {
    expect(resolveAgentStatus(makeThreadFixture({ runtime })).label).toBe("Working");
    expect(
      resolveAgentStatus(makeThreadFixture({ runtime, hasPendingApprovals: true })).label,
    ).toBe("Approval");
    expect(
      resolveAgentStatus(makeThreadFixture({ runtime, hasPendingUserInput: true })).label,
    ).toBe("Needs you");
    expect(
      resolveAgentStatus(makeThreadFixture({ runtime, pendingSubagentRequest: "approval" })).label,
    ).toBe("Approval");
  });
  it("shows unread completion until visited, honoring mark-unread on the server", () => {
    const thread = makeThreadFixture({
      runtime: null,
      latestRun,
      lastVisitedAt: "2026-10-24T10:01:00Z",
    });
    expect(resolveAgentStatus(thread).label).toBe("Unread");
    expect(resolveAgentStatus({ ...thread, lastVisitedAt: "2026-10-24T10:06:00Z" }).label).toBe(
      "Read",
    );
    expect(resolveAgentStatus(thread, "2026-10-24T10:07:00Z").label).toBe("Unread");
    expect(resolveAgentStatus({ ...thread, lastVisitedAt: null }).label).toBe("Unread");
  });
  it("keeps plan review and missing status visible", () => {
    expect(
      resolveAgentStatus(makeThreadFixture({ runtime: null, hasActionableProposedPlan: true }))
        .label,
    ).toBe("Review plan");
    expect(resolveAgentStatus(null).label).toBe("Unavailable");
  });
});
