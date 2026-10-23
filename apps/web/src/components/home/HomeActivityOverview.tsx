import { Link } from "@tanstack/react-router";
import {
  ActivityIcon,
  ArrowUpRightIcon,
  CheckIcon,
  CircleAlertIcon,
  LayersIcon,
} from "lucide-react";
import { useDeferredValue, useState } from "react";
import type { ServerProvider } from "@t3tools/contracts";
import {
  scopedProjectKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  useThreadShells,
  useProjects,
  useAllEnvironmentShellsBootstrapped,
} from "../../state/entities";
import { useEnvironments, useEnvironmentProviders } from "../../state/environments";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useUiStateStore } from "../../uiStateStore";
import { buildThreadRouteParams } from "../../threadRoutes";
import { hasUnseenCompletion, resolveThreadLastVisitedAt } from "../Sidebar.logic";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { AgentElapsed } from "../chat/AgentElapsed";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import {
  buildHomeActivity,
  type HomeActivity as Activity,
  type HomeActivityKind,
} from "./HomeActivity.logic";
import styles from "./HomeActivity.module.css";
import { cn } from "../../lib/utils";

const GROUPS = [
  { kind: "attention", title: "Needs attention", hint: "Your next move" },
  { kind: "working", title: "Working", hint: "Agents in motion" },
  { kind: "review", title: "Ready to revisit", hint: "Unsettled work" },
] as const;
const STATUS_COLOR: Record<HomeActivityKind, string> = {
  attention: "text-warning",
  working: "text-info",
  review: "text-success",
};

export function HomeActivity() {
  const threads = useDeferredValue(useThreadShells());
  const projects = useProjects();
  const { environments } = useEnvironments();
  const providers = useEnvironmentProviders();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const localVisits = useUiStateStore((state) => state.threadLastVisitedAtById);
  const now = useNowMinute();
  const rows = buildHomeActivity(threads, `${now}:00.000Z`);
  const projectNames = new Map(
    projects.map((project) => [
      scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
      project.title,
    ]),
  );
  const connected = environments.filter(
    (environment) => environment.connection.phase === "connected",
  ).length;
  const [visibleCount, setVisibleCount] = useState(24);
  const visible = rows.slice(0, visibleCount);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-5 py-8 sm:px-10 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="text-2xs font-medium uppercase tracking-widest text-muted-foreground">
            Workspace activity
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Your agents, at a glance.
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Your agents work here. Open a thread when it needs your attention.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {connected} {connected === 1 ? "environment" : "environments"} connected
        </p>
      </div>
      <div className="grid grid-cols-3 divide-x divide-border/60 rounded-xl border border-border/60 bg-muted/20 py-4">
        {GROUPS.map((group) => (
          <div key={group.kind} className="space-y-1 px-4 sm:px-6">
            <p
              className={cn(
                "text-2xl font-medium tabular-nums tracking-tight",
                STATUS_COLOR[group.kind],
              )}
            >
              {rows.filter((row) => row.kind === group.kind).length}
            </p>
            <p className="text-xs text-muted-foreground">{group.title}</p>
          </div>
        ))}
      </div>
      {!bootstrapped && (
        <p role="status" className="text-xs text-muted-foreground">
          Syncing activity from your environments…
        </p>
      )}
      {environments.length > connected && (
        <p className="text-xs text-muted-foreground">
          Offline environments retain their last known activity.
        </p>
      )}
      {rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>A quiet workspace</EmptyTitle>
            <EmptyDescription>
              Unsettled threads appear here as you work. Start or reopen a thread from the sidebar;
              your saved drafts stay ready.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        GROUPS.map((group) => {
          const items = visible.filter((row) => row.kind === group.kind);
          if (items.length === 0) return null;
          return (
            <section key={group.kind} aria-label={group.title} className="space-y-3">
              <div className="flex items-baseline justify-between gap-3 px-1">
                <h2 className="text-sm font-semibold">{group.title}</h2>
                <span className="text-2xs text-muted-foreground">{group.hint}</span>
              </div>
              <ul className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60">
                {items.map((row) => {
                  const environment = environments.find(
                    (entry) => entry.environmentId === row.thread.environmentId,
                  );
                  const visitedAt = resolveThreadLastVisitedAt(
                    row.thread.lastVisitedAt,
                    localVisits[row.key],
                  );
                  return (
                    <ActivityRow
                      key={row.key}
                      row={row}
                      providers={providers.get(row.thread.environmentId) ?? []}
                      project={
                        projectNames.get(
                          scopedProjectKey(
                            scopeProjectRef(row.thread.environmentId, row.thread.projectId),
                          ),
                        ) ?? "Project"
                      }
                      environment={environment?.label ?? row.thread.environmentId}
                      online={environment?.connection.phase === "connected"}
                      unread={hasUnseenCompletion({ ...row.thread, lastVisitedAt: visitedAt })}
                    />
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
      {rows.length > visibleCount && (
        <div className="flex justify-center">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setVisibleCount((count) => count + 24)}
          >
            Show more threads ({rows.length - visibleCount})
          </Button>
        </div>
      )}
      <p className="text-center text-2xs text-muted-foreground">
        Viewing Home preserves unread activity. Opening a thread marks it read as usual.
      </p>
    </div>
  );
}

function ActivityRow({
  row,
  providers,
  project,
  environment,
  online,
  unread,
}: {
  readonly row: Activity;
  readonly providers: readonly ServerProvider[];
  readonly project: string;
  readonly environment: string;
  readonly online: boolean;
  readonly unread: boolean;
}) {
  const current = providers.find(
    (provider) => provider.instanceId === row.thread.modelSelection.instanceId,
  );
  const providerName =
    current?.displayName ??
    row.thread.runtime?.providerName ??
    row.thread.modelSelection.instanceId;
  const uniqueIds = [...new Set(row.members.map((member) => member.modelSelection.instanceId))];
  const roster = uniqueIds
    .map((id) => providers.find((provider) => provider.instanceId === id))
    .filter((provider): provider is ServerProvider => provider !== undefined);
  const background = row.members
    .flatMap((member) => member.pendingBackgroundTasks)
    .find((task) => task.description)?.description;
  const message = row.thread.source.latestVisibleMessage?.text;
  const preview = (background ? `Background: ${background}` : message ? `Latest: ${message}` : "")
    .replace(/\s+/g, " ")
    .slice(0, 180);
  const Icon =
    row.kind === "attention" ? CircleAlertIcon : row.kind === "working" ? ActivityIcon : CheckIcon;
  return (
    <li className={styles.enter}>
      <Link
        to="/$environmentId/$threadId"
        params={buildThreadRouteParams(scopeThreadRef(row.thread.environmentId, row.thread.id))}
        className="group flex items-center gap-3 px-4 py-4 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:gap-4 sm:px-5"
      >
        <span className="hidden size-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-background sm:flex">
          {current ? (
            <ProviderInstanceIcon
              driverKind={current.driver}
              displayName={providerName}
              accentColor={current.accentColor}
              showBadge={false}
            />
          ) : (
            <LayersIcon className="size-4 text-muted-foreground" />
          )}
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{row.thread.title}</span>
            {unread && (
              <span
                className="size-1.5 shrink-0 rounded-full bg-info"
                aria-label="Unread completion"
              />
            )}
          </div>
          {preview && <p className="truncate text-xs text-muted-foreground">{preview}</p>}
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
            <span
              className="max-w-48 truncate"
              aria-label={`${providerName} · ${row.thread.modelSelection.model}`}
            >
              {providerName} · {row.thread.modelSelection.model}
            </span>
            <span aria-hidden>·</span>
            <span className="max-w-32 truncate">{project}</span>
            <span aria-hidden>·</span>
            <span className="max-w-32 truncate">{environment}</span>
            {row.agentCount > 1 && (
              <span
                className="inline-flex items-center gap-1.5"
                aria-label={`Known roster: ${row.members.length} linked thread agents, ${row.nativeAgentCount} additional provider-reported background agents`}
              >
                <span className="inline-flex -space-x-1">
                  {roster.slice(0, 3).map((provider) => (
                    <span
                      key={provider.instanceId}
                      className="rounded-full bg-background ring-2 ring-background"
                    >
                      <ProviderInstanceIcon
                        driverKind={provider.driver}
                        displayName={provider.displayName ?? provider.instanceId}
                        size="compact"
                        showBadge={false}
                      />
                    </span>
                  ))}
                </span>
                <span>{row.agentCount} agents</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 pl-1">
          <span
            key={row.label}
            className={cn(
              "inline-flex items-center gap-1.5 text-2xs font-medium",
              styles.enter,
              online ? STATUS_COLOR[row.kind] : "text-muted-foreground",
            )}
          >
            <Icon className="size-3" />
            {online ? row.label : "Offline"}
          </span>
          <span
            className="text-xs tabular-nums text-muted-foreground"
            aria-label={
              online ? "Elapsed time for the latest task" : `Last known status: ${row.label}`
            }
          >
            {online && row.startedAt ? (
              <AgentElapsed
                compact
                agent={{
                  status: row.completedAt ? "completed" : "running",
                  startedAt: row.startedAt,
                  completedAt: row.completedAt,
                }}
              />
            ) : online ? (
              "—"
            ) : (
              "Last known"
            )}
          </span>
          <ArrowUpRightIcon
            aria-hidden
            className="hidden size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 sm:block"
          />
        </div>
      </Link>
    </li>
  );
}
