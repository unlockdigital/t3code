import { expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { selectAgentAutoTargets } from "./agentPermissions";

it("changes the agent first and only its direct app-owned subagents in this environment", () => {
  const environmentId = EnvironmentId.make("local");
  const threadId = ThreadId.make("teddy");
  const parent = {
    id: threadId,
    environmentId,
    runtimeMode: "approval-required" as const,
    source: { creationSource: "mcp" as const, archivedAt: null, deletedAt: null },
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
  };
  const child = {
    ...parent,
    id: ThreadId.make("child"),
    lineage: {
      parentThreadId: threadId,
      relationshipToParent: "subagent" as const,
      rootThreadId: threadId,
    },
  };
  const threads = [
    child,
    { ...child, id: ThreadId.make("auto"), runtimeMode: "auto" as const },
    { ...child, environmentId: EnvironmentId.make("remote") },
    { ...child, source: { ...child.source, creationSource: "provider" as const } },
    { ...child, lineage: { ...child.lineage, relationshipToParent: "fork" as const } },
    parent,
  ];
  expect(
    selectAgentAutoTargets(threads, { environmentId, threadId }).map((thread) => thread.id),
  ).toEqual([threadId, child.id]);
  expect(selectAgentAutoTargets([child], { environmentId, threadId })).toEqual([]);
});
