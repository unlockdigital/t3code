import { Link, useNavigate } from "@tanstack/react-router";
import {
  ActivityIcon,
  ArrowUpRightIcon,
  CheckIcon,
  CircleAlertIcon,
  LayersIcon,
  EllipsisIcon,
  MailIcon,
} from "lucide-react";
import {
  useDeferredValue,
  useState,
  useRef,
  useEffect,
  useEffectEvent,
  type MouseEvent,
} from "react";
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
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { AgentElapsed } from "../chat/AgentElapsed";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import {
  buildHomeActivity,
  type HomeActivity as Activity,
  type HomeActivityKind,
} from "./HomeActivity.logic";
import { useThreadActionMenu } from "../../hooks/useThreadActionMenu";
import { HomeThreadRenameDialog } from "./HomeThreadRenameDialog";
import { toastManager } from "../ui/toast";
import styles from "./HomeActivity.module.css";
import { cn } from "../../lib/utils";

const GROUPS = [
  { kind: "attention", title: "Needs attention", hint: "Your next move" },
  { kind: "working", title: "Working", hint: "Agents in motion" },
  { kind: "unread", title: "Unread", hint: "Completed and waiting for you" },
  { kind: "done", title: "Done", hint: "Read and resting" },
] as const;
const STATUS_COLOR: Record<HomeActivityKind, string> = {
  attention: "text-warning",
  working: "text-info",
  unread: "text-info",
  done: "text-muted-foreground",
};

export function HomeActivity() {
  const threads = useDeferredValue(useThreadShells());
  const projects = useProjects();
  const { environments } = useEnvironments();
  const providers = useEnvironmentProviders();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const localVisits = useUiStateStore((state) => state.threadLastVisitedAtById);
  const now = useNowMinute();
  const liveRows = buildHomeActivity(threads, `${now}:00.000Z`, localVisits);
  const [held, setHeld] = useState<{ rows: Activity[]; at: string } | null>(null);
  const rows = held?.rows ?? liveRows;
  const [renaming, setRenaming] = useState<Activity | null>(null);
  const { openMenu, closeMenu } = useThreadActionMenu();
  const navigate = useNavigate();
  const pendingNavigation = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelNavigation = () => {
    if (pendingNavigation.current !== null) clearTimeout(pendingNavigation.current);
    pendingNavigation.current = null;
  };
  const closeMenuOnUnmount = useEffectEvent(() => closeMenu());
  useEffect(
    () => () => {
      if (pendingNavigation.current !== null) clearTimeout(pendingNavigation.current);
      closeMenuOnUnmount();
    },
    [],
  );
  const openThreadMenu = (row: Activity, position: { x: number; y: number }, at: string) => {
    cancelNavigation();
    if (held) return;
    // Live groups can move a row to another section while its native menu is still open.
    setHeld({ rows, at });
    const project = projects.find(
      (entry) =>
        entry.environmentId === row.thread.environmentId && entry.id === row.thread.projectId,
    );
    void openMenu(position, {
      threadRef: scopeThreadRef(row.thread.environmentId, row.thread.id),
      projectCwd: project?.workspaceRoot ?? null,
      onStartRename: () => setRenaming(row),
    })
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Thread action failed",
          description:
            error instanceof Error ? error.message : "Try opening the thread menu again.",
        });
      })
      .finally(() => setHeld(null));
  };
  const openThread = (row: Activity, event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.detail === 0)
      return;
    event.preventDefault();
    cancelNavigation();
    if (event.detail > 1) return;
    // Match the chat title's double-click window so a menu gesture never opens the chat first.
    pendingNavigation.current = setTimeout(() => {
      pendingNavigation.current = null;
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(row.thread.environmentId, row.thread.id)),
      });
    }, 500);
  };
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
    <div
      className={cn(
        "mx-auto w-full max-w-5xl space-y-8 px-5 py-8 sm:px-10 sm:py-12",
        held && styles.held,
      )}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Workspace activity</p>
          <h1 className="text-lg font-medium">Your agents at a glance</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Your agents work here. Open a thread when it needs your attention.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {connected} {connected === 1 ? "environment" : "environments"} connected
        </p>
      </div>
      <div className="grid grid-cols-2 gap-y-4 rounded-xl border border-border/60 bg-muted/20 py-4 sm:grid-cols-4 sm:divide-x">
        {GROUPS.map((group) => (
          <div key={group.kind} className="space-y-1 px-4 sm:px-6">
            <p className={cn("text-lg font-medium tabular-nums", STATUS_COLOR[group.kind])}>
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
              Your threads appear here as you work. Start a thread from the sidebar to get going.
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
                  return (
                    <ActivityRow
                      key={row.key}
                      row={row}
                      pausedAt={held?.at ?? null}
                      onOpen={(event) => openThread(row, event)}
                      onMenu={(position, at) => openThreadMenu(row, position, at)}
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
      {renaming && (
        <HomeThreadRenameDialog thread={renaming.thread} onClose={() => setRenaming(null)} />
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
  pausedAt,
  onOpen,
  onMenu,
}: {
  readonly row: Activity;
  readonly providers: readonly ServerProvider[];
  readonly project: string;
  readonly environment: string;
  readonly online: boolean;
  readonly pausedAt: string | null;
  readonly onOpen: (event: MouseEvent) => void;
  readonly onMenu: (position: { x: number; y: number }, at: string) => void;
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
    row.kind === "attention"
      ? CircleAlertIcon
      : row.kind === "working"
        ? ActivityIcon
        : row.kind === "unread"
          ? MailIcon
          : CheckIcon;
  return (
    <li className={cn(styles.enter, "flex items-center pr-2")}>
      <Link
        to="/$environmentId/$threadId"
        params={buildThreadRouteParams(scopeThreadRef(row.thread.environmentId, row.thread.id))}
        onClick={onOpen}
        onDoubleClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onMenu({ x: event.clientX, y: event.clientY }, new Date(Date.now()).toISOString());
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onMenu({ x: event.clientX, y: event.clientY }, new Date(Date.now()).toISOString());
        }}
        onKeyDown={(event) => {
          if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            onMenu({ x: rect.left, y: rect.bottom }, new Date(Date.now()).toISOString());
          }
        }}
        className="group flex min-w-0 flex-1 items-center gap-3 px-4 py-4 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:gap-4 sm:px-5"
      >
        <span className="hidden size-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-background sm:flex">
          {current ? (
            <ProviderInstanceIcon
              driverKind={current.driver}
              instanceId={current.instanceId}
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
            {row.unread && (
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
                        instanceId={provider.instanceId}
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
                  status: row.completedAt || pausedAt ? "completed" : "running",
                  startedAt: row.startedAt,
                  completedAt: row.completedAt ?? pausedAt,
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
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Actions for ${row.thread.title}`}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onMenu({ x: rect.left, y: rect.bottom }, new Date(Date.now()).toISOString());
        }}
      >
        <EllipsisIcon />
      </Button>
    </li>
  );
}
