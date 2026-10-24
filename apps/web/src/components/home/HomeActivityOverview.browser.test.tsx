import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type ServerProvider,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@t3tools/contracts/settings";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { act, render, fakeTimers } from "../../../test/render";
import { makeThreadFixture } from "../../test-fixtures";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useComposerDraftStore } from "../../composerDraftStore";

const state = vi.hoisted(() => ({
  threads: [] as EnvironmentThreadShell[],
  listeners: new Set<() => void>(),
  projects: [] as never[],
  visits: {},
  environments: [{ environmentId: "local", label: "This Mac", connection: { phase: "connected" } }],
  providers: new Map<EnvironmentId, readonly ServerProvider[]>(),
  settings: null as UnifiedSettings | null,
  show: vi.fn(),
}));
vi.mock("../../state/entities", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useThreadShells: () =>
      useSyncExternalStore(
        (listener) => {
          state.listeners.add(listener);
          return () => {
            state.listeners.delete(listener);
          };
        },
        () => state.threads,
      ),
    useProjects: () => state.projects,
    useProject: () => null,
    useAllEnvironmentShellsBootstrapped: () => true,
  };
});
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({ environments: state.environments }),
  useEnvironmentProviders: () => state.providers,
}));
vi.mock("../../uiStateStore", () => ({
  useUiStateStore: () => state.visits,
}));
vi.mock("../../hooks/useSettings", () => ({
  useEnvironmentSettings: () => state.settings ?? DEFAULT_UNIFIED_SETTINGS,
}));
vi.mock("../../hooks/useThreadActionMenu", () => ({
  useThreadActionMenu: () => ({ openMenu: state.show, closeMenu: () => {} }),
}));
vi.mock("./HomeThreadRenameDialog", () => ({ HomeThreadRenameDialog: () => null }));
vi.mock("./HomeCreateActions", () => ({ HomeCreateActions: () => null }));
import { HomeActivity } from "./HomeActivityOverview";

function setup() {
  state.listeners.clear();
  state.show.mockReset();
  state.providers.clear();
  state.settings = null;
  useComposerDraftStore.setState({ draftsByThreadKey: {} });
  const runId = RunId.make("run");
  const working = makeThreadFixture({
    id: ThreadId.make("mcp:working"),
    environmentId: EnvironmentId.make("local"),
    title: "Working task",
    lastVisitedAt: "2026-10-23T11:59:00Z",
    runtime: {
      status: "running",
      activeRunId: runId,
      providerInstanceId: ProviderInstanceId.make("codex"),
      providerName: "Codex",
      lastError: null,
      updatedAt: "2026-10-23T12:00:00Z",
    },
    latestRun: {
      runId,
      status: "running",
      requestedAt: "2026-10-23T12:00:00Z",
      startedAt: "2026-10-23T12:00:00Z",
      completedAt: null,
      assistantMessageId: null,
    },
  });
  state.threads = [working];
  let dismiss!: () => void;
  const pending = new Promise<void>((resolve) => {
    dismiss = resolve;
  });
  state.show.mockReturnValue(pending);
  return { working, dismiss };
}

it("holds live rows and stays on Home while a context menu is open, then catches up", async () => {
  const { working, dismiss } = setup();
  using now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-23T12:13:00Z"));
  await using screen = await render(<HomeActivity />, { router: "/home" });
  await userEvent.click(screen.getByRole("link", { name: /Working task/ }), { button: "right" });
  expect(state.show).toHaveBeenCalledOnce();
  now.mockReturnValue(Date.parse("2026-10-23T12:18:00Z"));
  await expect
    .element(screen.getByLabelText("Elapsed time for the latest task"))
    .toHaveTextContent("13m");
  await act(() => {
    state.threads = [
      {
        ...working,
        title: "Completed task",
        runtime: null,
        latestRun: {
          ...working.latestRun!,
          status: "completed",
          completedAt: "2026-10-23T12:13:00Z",
        },
      },
    ];
    for (const listener of state.listeners) listener();
  });
  await expect.element(screen.getByText("Working task", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("Completed task", { exact: true })).not.toBeInTheDocument();
  expect(screen.router?.state.location.pathname).toBe("/home");
  await act(() => dismiss());
  await expect.element(screen.getByText("Completed task", { exact: true })).toBeVisible();
  await expect.element(screen.getByLabelText("Unread completion")).toBeInTheDocument();
  expect(screen.router?.state.location.pathname).toBe("/home");
});

it("opens the thread menu on a double-click without navigating to or reading the chat", async () => {
  const { dismiss } = setup();
  await using screen = await render(<HomeActivity />, { router: "/home" });
  using _timers = fakeTimers();
  await userEvent.dblClick(screen.getByRole("link", { name: /Working task/ }));
  expect(state.show).toHaveBeenCalledOnce();
  await act(() => vi.advanceTimersByTime(500));
  expect(screen.router?.state.location.pathname).toBe("/home");
  await act(() => dismiss());
});

it("moves completed work to Unread and Done while its preview server keeps running", async () => {
  const { working } = setup();
  await using screen = await render(<HomeActivity />, { router: "/home" });
  await expect.element(screen.getByRole("region", { name: "Working", exact: true })).toBeVisible();
  const completed = {
    ...working,
    runtime: { ...working.runtime!, status: "completed" as const, activeRunId: null },
    latestRun: {
      ...working.latestRun!,
      status: "completed" as const,
      completedAt: "2026-10-23T12:13:00Z",
    },
    pendingBackgroundTasks: [{ kind: "command" as const, taskId: "preview-server" }],
  };
  await act(() => {
    state.threads = [completed];
    for (const listener of state.listeners) listener();
  });
  await expect
    .element(screen.getByRole("region", { name: "Working", exact: true }))
    .not.toBeInTheDocument();
  await expect.element(screen.getByRole("region", { name: "Unread", exact: true })).toBeVisible();
  await act(() => {
    state.threads = [{ ...completed, lastVisitedAt: "2026-10-23T12:14:00Z" }];
    for (const listener of state.listeners) listener();
  });
  await expect
    .element(screen.getByRole("region", { name: "Unread", exact: true }))
    .not.toBeInTheDocument();
  await expect.element(screen.getByRole("region", { name: "Done", exact: true })).toBeVisible();
});

it("clears an old child usage limit when the parent continues and waits for new reviewers", async () => {
  const { working } = setup();
  const child = {
    ...working,
    id: ThreadId.make("old-child"),
    title: "Old validation task",
    runtime: {
      ...working.runtime!,
      status: "failed" as const,
      activeRunId: null,
      lastErrorClass: "usage_limit" as const,
    },
    latestRun: {
      ...working.latestRun!,
      status: "failed" as const,
      completedAt: "2026-10-23T12:01:00Z",
    },
    lineage: {
      rootThreadId: working.id,
      parentThreadId: working.id,
      relationshipToParent: "subagent" as const,
    },
  };
  state.threads = [working, child];
  await using screen = await render(<HomeActivity />, { router: "/home" });
  await expect.element(screen.getByRole("region", { name: "Needs attention" })).toBeVisible();
  await expect.element(screen.getByText("Usage limit", { exact: true })).toBeVisible();
  await act(() => {
    state.threads = [
      {
        ...working,
        runtime: { ...working.runtime!, status: "idle", activeRunId: null },
        latestRun: {
          ...working.latestRun!,
          runId: RunId.make("continued-run"),
          status: "completed",
          requestedAt: "2026-10-23T12:02:00Z",
          startedAt: "2026-10-23T12:02:00Z",
          completedAt: "2026-10-23T12:03:00Z",
        },
        pendingBackgroundTasks: [{ kind: "subagent", taskId: "new-review" }],
      },
      child,
    ];
    for (const listener of state.listeners) listener();
  });
  await expect
    .element(screen.getByRole("region", { name: "Needs attention" }))
    .not.toBeInTheDocument();
  await expect.element(screen.getByRole("region", { name: "Working", exact: true })).toBeVisible();
  await expect.element(screen.getByText("Waiting for agents", { exact: true })).toBeVisible();
});

it("follows the main thread's model picker through local model and provider changes", async () => {
  const { working } = setup();
  const primary = ProviderInstanceId.make("opencode-home-primary");
  const secondary = ProviderInstanceId.make("opencode-home-secondary");
  const driver = ProviderDriverKind.make("opencode");
  state.settings = {
    ...DEFAULT_UNIFIED_SETTINGS,
    providerInstances: {
      [primary]: { driver, enabled: true, config: {} },
      [secondary]: { driver, enabled: true, config: {} },
    },
  };
  const models = [
    { slug: "invented/first", name: "First model", isCustom: false, capabilities: {} },
    { slug: "invented/second", name: "Second model", isCustom: false, capabilities: {} },
  ];
  state.providers.set(
    working.environmentId,
    [
      { instanceId: primary, displayName: "Unlock Digital" },
      { instanceId: secondary, displayName: "Unlock Digital Review" },
    ].map((identity): ServerProvider => ({
      ...identity,
      driver,
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-10-23T12:00:00Z",
      models,
      slashCommands: [],
      skills: [],
    })),
  );
  const parent = {
    ...working,
    modelSelection: { instanceId: primary, model: "invented/first" },
    runtime: { ...working.runtime!, providerInstanceId: primary, providerName: "opencode" },
  };
  state.threads = [
    parent,
    {
      ...working,
      id: ThreadId.make("review-child"),
      title: "Review task",
      modelSelection: { instanceId: secondary, model: "invented/second" },
      lineage: {
        rootThreadId: parent.id,
        parentThreadId: parent.id,
        relationshipToParent: "subagent",
      },
    },
  ];
  const threadRef = scopeThreadRef(parent.environmentId, parent.id);
  // Another environment can have a thread and provider with the same IDs.
  useComposerDraftStore
    .getState()
    .setModelSelection(
      scopeThreadRef(EnvironmentId.make("other-environment"), parent.id),
      { instanceId: primary, model: "invented/second" },
      { explicit: true },
    );
  await using screen = await render(<HomeActivity />, { router: "/home" });
  await expect.element(screen.getByLabelText("Unlock Digital · First model")).toBeVisible();
  await act(() => {
    useComposerDraftStore
      .getState()
      .setModelSelection(
        threadRef,
        { instanceId: primary, model: "invented/second" },
        { explicit: true },
      );
  });
  await expect.element(screen.getByLabelText("Unlock Digital · Second model")).toBeVisible();
  await act(() => {
    useComposerDraftStore
      .getState()
      .setModelSelection(
        threadRef,
        { instanceId: secondary, model: "invented/first" },
        { explicit: true },
      );
  });
  await expect.element(screen.getByLabelText("Unlock Digital Review · First model")).toBeVisible();
  await act(() => {
    useComposerDraftStore.setState({ draftsByThreadKey: {} });
    state.threads = [
      { ...parent, modelSelection: { instanceId: primary, model: "invented/second" } },
    ];
    for (const listener of state.listeners) listener();
  });
  await expect.element(screen.getByLabelText("Unlock Digital · Second model")).toBeVisible();
});
