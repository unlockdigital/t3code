import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  resolveThreadWorkingStartedAt,
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { resolveSidebarThreadStatus } from "../Sidebar.logic";

type Thread = EnvironmentThreadShell;
export type HomeActivityKind = "attention" | "working" | "review";
export interface HomeActivity {
  readonly key: string;
  readonly thread: Thread;
  readonly members: readonly Thread[];
  readonly kind: HomeActivityKind;
  readonly label: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly agentCount: number;
  readonly nativeAgentCount: number;
}
const keyOf = (thread: Thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
const needsAttention = (thread: Thread) =>
  ["approval", "input", "failed", "limited"].includes(resolveSidebarThreadStatus(thread));
const doingWork = (thread: Thread) =>
  threadRuntimeIsActive(thread.runtime) || thread.pendingBackgroundTasks.length > 0;

export function buildHomeActivity(threads: readonly Thread[], now: string): HomeActivity[] {
  const visible = threads.filter(
    (thread) => thread.archivedAt === null && thread.deletedAt === null,
  );
  const byKey = new Map(visible.map((thread) => [keyOf(thread), thread]));
  const groups = new Map<string, { thread: Thread; members: Thread[] }>();
  for (const thread of visible) {
    let root = thread;
    const visited = new Set<string>();
    while (
      root.lineage.relationshipToParent === "subagent" &&
      root.lineage.parentThreadId !== null
    ) {
      const key = keyOf(root);
      if (visited.has(key)) {
        root = thread;
        break;
      }
      visited.add(key);
      const parent = byKey.get(
        scopedThreadKey(scopeThreadRef(root.environmentId, root.lineage.parentThreadId)),
      );
      if (!parent) break;
      root = parent;
    }
    const key = keyOf(root);
    const group = groups.get(key) ?? { thread: root, members: [] };
    group.members.push(thread);
    groups.set(key, group);
  }
  const rows: HomeActivity[] = [];
  for (const [key, { thread, members }] of groups) {
    const active = members.filter(
      (member) =>
        doingWork(member) || (member.settledOverride !== "settled" && needsAttention(member)),
    );
    if (thread.settledOverride === "settled" && active.length === 0) continue;
    if (effectiveSnoozed(thread, { now }) && active.length === 0) continue;
    const attention = active.find(needsAttention);
    const working = active.filter(doingWork);
    const kind: HomeActivityKind = attention
      ? "attention"
      : working.length > 0
        ? "working"
        : "review";
    const attentionStatus = attention ? resolveSidebarThreadStatus(attention) : null;
    const label =
      attentionStatus === "approval"
        ? "Approval needed"
        : attentionStatus === "input"
          ? "Reply needed"
          : attentionStatus === "failed"
            ? "Failed"
            : attentionStatus === "limited"
              ? "Usage limit"
              : kind === "working"
                ? thread.blockedOnThreadWait
                  ? "Waiting for agents"
                  : "Working"
                : thread.hasActionableProposedPlan
                  ? "Plan ready"
                  : thread.latestRun?.completedAt
                    ? "Done"
                    : "Ready";
    const starts = (
      working.length === 0
        ? [
            (attention ?? thread).latestRun?.completedAt
              ? ((attention ?? thread).latestRun?.startedAt ??
                (attention ?? thread).latestRun?.requestedAt ??
                null)
              : null,
          ]
        : working.map(resolveThreadWorkingStartedAt)
    ).filter((value): value is string => value !== null && Number.isFinite(Date.parse(value)));
    const startedAt = starts.toSorted((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
    const memberKeys = new Set(members.map(keyOf));
    // Child threads already in the shell roster must not also count as native background agents.
    const nativeAgentCount = members.reduce(
      (count, member) =>
        count +
        member.pendingBackgroundTasks.filter(
          (task) =>
            task.kind === "subagent" &&
            !(
              "childThreadId" in task &&
              typeof task.childThreadId === "string" &&
              memberKeys.has(
                scopedThreadKey(scopeThreadRef(member.environmentId, task.childThreadId)),
              )
            ),
        ).length,
      0,
    );
    rows.push({
      key,
      thread,
      members,
      kind,
      label,
      startedAt,
      completedAt:
        working.length === 0 ? ((attention ?? thread).latestRun?.completedAt ?? null) : null,
      agentCount: members.length + nativeAgentCount,
      nativeAgentCount,
    });
  }
  const rank: Record<HomeActivityKind, number> = { attention: 0, working: 1, review: 2 };
  return rows.sort(
    (a, b) =>
      rank[a.kind] - rank[b.kind] ||
      Date.parse(b.thread.updatedAt) - Date.parse(a.thread.updatedAt) ||
      a.key.localeCompare(b.key),
  );
}
