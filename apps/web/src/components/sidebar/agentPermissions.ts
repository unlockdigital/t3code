import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ScopedThreadRef } from "@t3tools/contracts";

type AgentThread = Pick<
  EnvironmentThreadShell,
  "id" | "environmentId" | "lineage" | "runtimeMode"
> & {
  readonly source: Pick<
    EnvironmentThreadShell["source"],
    "creationSource" | "archivedAt" | "deletedAt"
  >;
};

export function selectAgentAutoTargets<T extends AgentThread>(
  threads: readonly T[],
  agent: ScopedThreadRef,
): T[] {
  const local = threads.filter((thread) => thread.environmentId === agent.environmentId);
  const parent = local.find((thread) => thread.id === agent.threadId);
  if (!parent) return [];
  return [
    parent,
    ...local.filter(
      (thread) =>
        thread.id !== agent.threadId &&
        thread.source.creationSource === "mcp" &&
        thread.source.archivedAt === null &&
        thread.source.deletedAt === null &&
        thread.lineage.relationshipToParent === "subagent" &&
        thread.lineage.parentThreadId === agent.threadId,
    ),
  ].filter((thread) => thread.runtimeMode !== "auto");
}
