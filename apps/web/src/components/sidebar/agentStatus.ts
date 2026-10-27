import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  hasUnseenCompletion,
  resolveSidebarThreadStatus,
  resolveThreadLastVisitedAt,
} from "../Sidebar.logic";

export function resolveAgentStatus(thread: EnvironmentThreadShell | null, localVisitedAt?: string) {
  if (!thread) return { label: "Unavailable", color: "text-muted-foreground" };
  const status = resolveSidebarThreadStatus(thread);
  switch (status) {
    case "working":
      return { label: "Working", color: "text-info" };
    case "waiting":
      return { label: "Waiting", color: "text-muted-foreground" };
    case "approval":
      return { label: "Approval", color: "text-warning-foreground" };
    case "input":
      return { label: "Needs you", color: "text-warning-foreground" };
    case "failed":
      return { label: "Failed", color: "text-error" };
    case "limited":
      return { label: "Limited", color: "text-warning-foreground" };
  }
  if (thread.hasActionableProposedPlan)
    return { label: "Review plan", color: "text-warning-foreground" };
  const lastVisitedAt = resolveThreadLastVisitedAt(thread.lastVisitedAt, localVisitedAt);
  if (
    hasUnseenCompletion({ ...thread, lastVisitedAt }) ||
    (!lastVisitedAt && thread.latestRun?.completedAt)
  ) {
    return { label: "Unread", color: "text-success" };
  }
  return {
    label: thread.latestRun?.completedAt ? "Read" : "Ready",
    color: "text-muted-foreground",
  };
}
