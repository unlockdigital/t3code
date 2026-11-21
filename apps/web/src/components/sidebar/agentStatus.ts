import { msg } from "gt-react";
import { m, type MessageResolver } from "../../i18n/messages";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  hasUnseenCompletion,
  resolveSidebarThreadStatus,
  resolveThreadLastVisitedAt,
} from "../Sidebar.logic";

export function resolveAgentStatus(
  thread: EnvironmentThreadShell | null,
  localVisitedAt?: string,
  resolve: MessageResolver = m,
) {
  if (!thread) return { label: resolve(msg("Unavailable")), color: "text-muted-foreground" };
  const status = resolveSidebarThreadStatus(thread);
  switch (status) {
    case "working":
      return { label: resolve(msg("Working")), color: "text-info" };
    case "waiting":
      return { label: resolve(msg("Waiting")), color: "text-muted-foreground" };
    case "approval":
      return { label: resolve(msg("Approval")), color: "text-warning-foreground" };
    case "input":
      return { label: resolve(msg("Needs you")), color: "text-warning-foreground" };
    case "failed":
      return { label: resolve(msg("Failed")), color: "text-error" };
    case "limited":
      return { label: resolve(msg("Limited")), color: "text-warning-foreground" };
  }
  if (thread.hasActionableProposedPlan)
    return { label: resolve(msg("Review plan")), color: "text-warning-foreground" };
  const lastVisitedAt = resolveThreadLastVisitedAt(thread.lastVisitedAt, localVisitedAt);
  if (
    hasUnseenCompletion({ ...thread, lastVisitedAt }) ||
    (!lastVisitedAt && thread.latestRun?.completedAt)
  ) {
    return { label: resolve(msg("Unread")), color: "text-success" };
  }
  return {
    label: thread.latestRun?.completedAt ? resolve(msg("Read")) : resolve(msg("Ready")),
    color: "text-muted-foreground",
  };
}
