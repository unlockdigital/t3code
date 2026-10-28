import { ProviderInstanceId, type ProjectBriefState } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { ProjectBriefController } from "./projectBriefController";

function savedState(revision = "initial"): ProjectBriefState {
  return {
    revision,
    contextFile: null,
    saved: {
      text: "A documented project. Its mission is clear. Current emphasis is documented.",
      generatedAt: "2026-10-28T12:00:00.000Z",
      sources: ["README.md"],
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "configured-model" },
    },
  };
}
function emptyState(revision = "empty"): ProjectBriefState {
  return { revision, contextFile: null, saved: null };
}
function setup(cached?: ProjectBriefState) {
  const api = {
    get: vi.fn(async () => emptyState()),
    generate: vi.fn(async () => savedState("generated")),
    clear: vi.fn(async () => emptyState("cleared")),
    configure: vi.fn(async (contextFile: string | null) => ({
      ...emptyState("configured"),
      contextFile,
    })),
  };
  return { api, controller: new ProjectBriefController(api, cached) };
}
function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("explicit project brief actions", () => {
  it("performs zero requests when created, observed, or synchronized with saved metadata", () => {
    const { api, controller } = setup();
    const unsubscribe = controller.subscribe(() => {});
    controller.snapshot();
    controller.syncCached(savedState());
    unsubscribe();
    expect(api.get).not.toHaveBeenCalled();
    expect(api.generate).not.toHaveBeenCalled();
  });

  it("waits for confirmed absence, then coalesces repeated explicit views into one generation", async () => {
    const { api, controller } = setup();
    const read = deferred<ProjectBriefState>();
    api.get.mockReturnValue(read.promise);
    const first = controller.open(true);
    const second = controller.open(true);
    expect(first).toBe(second);
    expect(controller.snapshot().pending).toBe("read");
    expect(controller.snapshot().value).toBeUndefined();
    expect(api.generate).not.toHaveBeenCalled();
    read.resolve(emptyState());
    await first;
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.generate).toHaveBeenCalledTimes(1);
    expect(controller.snapshot().value?.saved?.text).toBe(savedState().saved?.text);
  });

  it("displays saved text without generation, including readers denied generation", async () => {
    const { api, controller } = setup();
    api.get.mockResolvedValue(savedState());
    await controller.open(false);
    expect(api.generate).not.toHaveBeenCalled();
    expect(controller.snapshot().value?.saved).toEqual(savedState().saved);
  });

  it("keeps unknown read failures distinct from confirmed absence", async () => {
    const { api, controller } = setup();
    api.get.mockRejectedValue(new Error("Disconnected"));
    await controller.open(true);
    expect(api.generate).not.toHaveBeenCalled();
    expect(controller.snapshot()).toMatchObject({
      value: undefined,
      pending: null,
      error: "Disconnected",
    });
  });

  it("retains prior saved text when refresh fails", async () => {
    const saved = savedState();
    const { api, controller } = setup(saved);
    api.generate.mockRejectedValue(new Error("Generation unavailable"));
    await controller.generate();
    expect(controller.snapshot()).toMatchObject({
      value: saved,
      pending: null,
      error: "Generation unavailable",
    });
    controller.syncCached({ ...saved, revision: "delayed-generation-start" });
    expect(controller.snapshot().error).toBe("Generation unavailable");
    expect(controller.snapshot().value?.saved).toEqual(saved.saved);
  });

  it("clear supersedes a pending generation and requires another explicit action", async () => {
    const { api, controller } = setup(savedState());
    const generation = deferred<ProjectBriefState>();
    api.generate.mockReturnValue(generation.promise);
    const pending = controller.generate();
    await controller.clear();
    generation.resolve(savedState("late"));
    await pending;
    expect(controller.snapshot().value).toEqual(emptyState("cleared"));
    expect(api.generate).toHaveBeenCalledTimes(1);
    controller.snapshot();
    expect(api.generate).toHaveBeenCalledTimes(1);
    api.generate.mockResolvedValue(savedState("explicit"));
    await controller.generate();
    expect(controller.snapshot().value?.saved).toEqual(savedState().saved);
  });

  it("clears an initial in-flight generation and allows a later explicit view to generate", async () => {
    const { api, controller } = setup();
    const generation = deferred<ProjectBriefState>();
    api.generate.mockReturnValue(generation.promise);
    const pending = controller.generate();
    await controller.clear();
    generation.resolve(savedState("late-initial"));
    await pending;
    expect(controller.snapshot().value).toEqual(emptyState("cleared"));
    controller.syncCached(emptyState("cleared"));
    expect(api.generate).toHaveBeenCalledTimes(1);
    api.get.mockResolvedValue(emptyState("cleared"));
    api.generate.mockResolvedValue(savedState("explicit-view"));
    await controller.open(true);
    expect(api.generate).toHaveBeenCalledTimes(2);
    expect(controller.snapshot().value?.revision).toBe("explicit-view");
  });

  it("accepts saved completion with the generation-start revision while the request is pending", async () => {
    const { api, controller } = setup(emptyState("before"));
    const generation = deferred<ProjectBriefState>();
    api.generate.mockReturnValue(generation.promise);
    const pending = controller.generate();
    controller.syncCached(emptyState("running"));
    expect(controller.snapshot().pending).toBe("generate");
    controller.syncCached(savedState("running"));
    expect(controller.snapshot().value?.saved).toEqual(savedState().saved);
    generation.resolve(savedState("running"));
    await pending;
    expect(controller.snapshot().pending).toBeNull();
    expect(controller.snapshot().value?.saved).toEqual(savedState().saved);
  });

  it("context changes discard pending results and await an explicit generation", async () => {
    const { api, controller } = setup(savedState());
    const generation = deferred<ProjectBriefState>();
    api.generate.mockReturnValue(generation.promise);
    const pending = controller.generate();
    await controller.configure("docs/mission.md");
    generation.resolve(savedState("late"));
    await pending;
    expect(controller.snapshot().value).toEqual({
      ...emptyState("configured"),
      contextFile: "docs/mission.md",
    });
    expect(api.generate).toHaveBeenCalledTimes(1);
  });
});
