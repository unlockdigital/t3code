import { describe, expect, it, vi } from "vite-plus/test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { EnvironmentId, ThreadId, RunId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { isThreadRoutePathname, resolveThreadRouteTarget } from "../../threadRoutes";
import { makeThreadFixture } from "../../test-fixtures";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { createThreadVisitTracker } from "./ThreadVisitWatermark.logic";

const ref = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("thread"));
const before = "2026-10-23T10:00:00.000Z";
const progress = "2026-10-23T10:00:01.000Z";
const completion = "2026-10-23T10:00:02.000Z";

async function setup() {
  const root = createRootRoute();
  let releaseHome = () => {};
  const pendingHome = new Promise<void>((resolve) => {
    releaseHome = resolve;
  });
  const thread = createRoute({ getParentRoute: () => root, path: "$environmentId/$threadId" });
  const home = createRoute({
    getParentRoute: () => root,
    path: "home",
    beforeLoad: () => pendingHome,
  });
  const router = createRouter({
    routeTree: root.addChildren([thread, home]),
    history: createMemoryHistory({ initialEntries: ["/local/thread"] }),
  });
  await router.load();
  const visits: string[] = [];
  const tracker = createThreadVisitTracker();
  const schedule = (updatedAt: string, lastVisitedAt = before, completedAt: string | null = null) =>
    tracker.schedule({
      threadKey: "local:thread",
      updatedAt,
      lastVisitedAt,
      completedAt,
      isActive: () => isThreadRoutePathname(router.state.location.pathname, ref),
      dispatch: () => visits.push(updatedAt),
    });
  return { router, schedule, visits, releaseHome };
}

describe("thread visit tracking during Home navigation", () => {
  it("keeps delayed progress and a newly completed turn unread while navigation is pending", async () => {
    const h = await setup();
    vi.useFakeTimers();
    using _timers = { [Symbol.dispose]: () => vi.useRealTimers() };
    h.schedule(progress);
    h.schedule(completion);
    expect(h.visits).toEqual([progress]);
    const navigation = h.router.navigate({ to: "/home" });
    expect(h.router.state.location.pathname).toBe("/home");
    h.schedule(completion, before, completion);
    vi.advanceTimersByTime(10_000);
    h.schedule(completion, before, completion);
    expect(h.visits).toEqual([progress]);
    h.releaseHome();
    await navigation;
    const params = h.router.state.matches.at(-1)!.params;
    expect(
      resolveThreadRouteTarget({
        environmentId: "environmentId" in params ? params.environmentId : undefined,
        threadId: "threadId" in params ? params.threadId : undefined,
        draftId: "draftId" in params ? params.draftId : undefined,
      }),
    ).toBeNull();
    await h.router.navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: "local", threadId: "thread" },
    });
    h.schedule(completion, before, completion);
    expect(h.visits).toEqual([progress, completion]);
  });

  it("retains the completion badge after Home and clears it on an ordinary return", async () => {
    const h = await setup();
    h.schedule(progress);
    h.releaseHome();
    await h.router.navigate({ to: "/home" });
    const runId = RunId.make("background-run");
    const thread = makeThreadFixture({
      environmentId: ref.environmentId,
      id: ref.threadId,
      lastVisitedAt: progress,
      latestRun: {
        runId,
        status: "completed",
        requestedAt: before,
        startedAt: before,
        completedAt: completion,
        assistantMessageId: null,
      },
    });
    h.schedule(completion, progress, completion);
    expect(resolveThreadStatusPill({ thread })).toMatchObject({ label: "Completed" });
    expect(h.visits).toEqual([progress]);
    await h.router.navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: "local", threadId: "thread" },
    });
    h.schedule(completion, progress, completion);
    expect(
      resolveThreadStatusPill({ thread: { ...thread, lastVisitedAt: h.visits.at(-1) } }),
    ).toBeNull();
  });

  it("keeps visits scoped to the selected environment", async () => {
    const h = await setup();
    h.schedule(progress);
    await h.router.navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: "remote", threadId: "thread" },
    });
    h.schedule(completion, progress, completion);
    expect(h.visits).toEqual([progress]);
  });

  it("cancels pending visits on cleanup and retains the normal completion fast path", async () => {
    const h = await setup();
    vi.useFakeTimers();
    using _timers = { [Symbol.dispose]: () => vi.useRealTimers() };
    h.schedule(progress);
    const cancel = h.schedule(completion);
    cancel?.();
    vi.advanceTimersByTime(10_000);
    expect(h.visits).toEqual([progress]);
    h.schedule(completion, before, completion);
    expect(h.visits).toEqual([progress, completion]);
    h.schedule(completion, before, completion);
    expect(h.visits).toEqual([progress, completion]);
  });
});
