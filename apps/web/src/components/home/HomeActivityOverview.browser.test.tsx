import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { EnvironmentId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { act, render, fakeTimers } from "../../../test/render";
import { makeThreadFixture } from "../../test-fixtures";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

const state = vi.hoisted(() => ({
  threads: [] as EnvironmentThreadShell[],
  listeners: new Set<() => void>(),
  projects: [] as never[],
  visits: {},
  environments: [{ environmentId: "local", label: "This Mac", connection: { phase: "connected" } }],
  providers: new Map(),
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
vi.mock("../../hooks/useThreadActionMenu", () => ({
  useThreadActionMenu: () => ({ openMenu: state.show, closeMenu: () => {} }),
}));
vi.mock("./HomeThreadRenameDialog", () => ({ HomeThreadRenameDialog: () => null }));
import { HomeActivity } from "./HomeActivityOverview";

function setup() {
  state.listeners.clear();
  state.show.mockReset();
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
