import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  resolveThreadWorkingStartedAt,
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import {
  hasUnseenCompletion,
  resolveSidebarThreadStatus,
  resolveThreadLastVisitedAt,
} from "../Sidebar.logic";

type Thread = EnvironmentThreadShell;
export type HomeActivityKind = "attention" | "working" | "unread" | "done";
export interface HomeActivity {
  readonly key: string;
  readonly thread: Thread;
  readonly members: readonly Thread[];
  readonly kind: HomeActivityKind;
  readonly unread: boolean;
  readonly label: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly agentCount: number;
  readonly nativeAgentCount: number;
}
const keyOf = (thread: Thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
const needsAttention = (thread: Thread, acknowledgedAt: readonly (string | null | undefined)[]) => {
  const status = resolveSidebarThreadStatus(thread);
  if (status === "approval" || status === "input") return true;
  if (status !== "failed" && status !== "limited") return false;
  const failedAt = Date.parse(thread.latestRun?.completedAt ?? thread.runtime?.updatedAt ?? "");
  if (!Number.isFinite(failedAt)) return true;
  return !acknowledgedAt.some((at) => at && Date.parse(at) >= failedAt);
};
const doingWork = (thread: Thread) =>
  threadRuntimeIsActive(thread.runtime) ||
  backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks);

export function buildHomeActivity(
  threads: readonly Thread[],
  now: string,
  localVisits: Readonly<Record<string, string>> = {},
): HomeActivity[] {
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
    if (thread.settledOverride === "settled") continue;
    const lastVisitedAt = resolveThreadLastVisitedAt(thread.lastVisitedAt, localVisits[key]);
    const attention = members.find(
      (member) =>
        member.settledOverride !== "settled" &&
        needsAttention(member, [
          resolveThreadLastVisitedAt(member.lastVisitedAt, localVisits[keyOf(member)]),
          lastVisitedAt,
          // Continuing the parent handles results from older child tasks.
          member !== thread ? (thread.latestRun?.startedAt ?? thread.latestRun?.requestedAt) : null,
        ]) &&
        !effectiveSnoozed(member, { now }) &&
        !effectiveSnoozed(
          { ...member, snoozedAt: thread.snoozedAt, snoozedUntil: thread.snoozedUntil },
          { now },
        ),
    );
    const working = members.filter(doingWork);
    if (effectiveSnoozed(thread, { now }) && !attention && working.length === 0) continue;
    const unread =
      Number.isFinite(Date.parse(thread.latestRun?.completedAt ?? "")) &&
      (!lastVisitedAt || hasUnseenCompletion({ ...thread, lastVisitedAt }));
    const kind: HomeActivityKind = attention
      ? "attention"
      : working.length > 0
        ? "working"
        : unread
          ? "unread"
          : "done";
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
                ? thread.blockedOnThreadWait ||
                  (!threadRuntimeIsActive(thread.runtime) &&
                    (working.some((member) => member !== thread) ||
                      thread.pendingBackgroundTasks.some((task) => task.kind === "subagent")))
                  ? "Waiting for agents"
                  : "Working"
                : kind === "unread"
                  ? "Unread"
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
      unread,
      label,
      startedAt,
      completedAt:
        working.length === 0 ? ((attention ?? thread).latestRun?.completedAt ?? null) : null,
      agentCount: members.length + nativeAgentCount,
      nativeAgentCount,
    });
  }
  const rank: Record<HomeActivityKind, number> = { attention: 0, working: 1, unread: 2, done: 3 };
  return rows.sort(
    (a, b) =>
      rank[a.kind] - rank[b.kind] ||
      Date.parse(b.thread.updatedAt) - Date.parse(a.thread.updatedAt) ||
      a.key.localeCompare(b.key),
  );
}
