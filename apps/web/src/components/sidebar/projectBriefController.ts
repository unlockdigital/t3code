import type { ProjectBriefState } from "@t3tools/contracts";

interface ProjectBriefApi {
  readonly get: () => Promise<ProjectBriefState>;
  readonly generate: () => Promise<ProjectBriefState>;
  readonly clear: () => Promise<ProjectBriefState>;
  readonly configure: (contextFile: string | null) => Promise<ProjectBriefState>;
}

interface BriefViewState {
  readonly value: ProjectBriefState | undefined;
  readonly pending: "read" | "generate" | "clear" | "configure" | null;
  readonly error: string | null;
}

// Only explicit actions call the API. Keeping this outside rendering also makes
// unknown, absent, and cleared states independent of mounting and reconnects.
export class ProjectBriefController {
  private state: BriefViewState;
  private listeners = new Set<() => void>();
  private epoch = 0;
  private active: Promise<void> | undefined;
  private cached: ProjectBriefState | undefined;

  constructor(
    private readonly api: ProjectBriefApi,
    cached: ProjectBriefState | undefined,
  ) {
    this.state = { value: cached, pending: null, error: null };
    this.cached = cached;
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = () => this.state;

  private publish(state: BriefViewState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  syncCached(value: ProjectBriefState | undefined) {
    if (JSON.stringify(value) === JSON.stringify(this.cached)) return;
    const invalidated =
      (this.cached?.contextFile ?? null) !== (value?.contextFile ?? null) ||
      (this.cached?.saved != null && value?.saved == null);
    const unchangedContent =
      (this.state.value?.contextFile ?? null) === (value?.contextFile ?? null) &&
      JSON.stringify(this.state.value?.saved ?? null) === JSON.stringify(value?.saved ?? null);
    this.cached = value;
    if (invalidated) {
      this.epoch++;
      this.active = undefined;
    }
    // A generation-start projection can carry a new revision with the same
    // saved text. Its eventual saved result shares that revision.
    this.publish({
      value,
      pending: invalidated ? null : this.state.pending,
      error: !invalidated && unchangedContent ? this.state.error : null,
    });
  }

  private run(
    pending: NonNullable<BriefViewState["pending"]>,
    action: (epoch: number) => Promise<ProjectBriefState>,
    replace = false,
  ): Promise<void> {
    if (this.active && !replace) return this.active;
    const epoch = ++this.epoch;
    this.publish({ ...this.state, pending, error: null });
    const active = (async () => {
      try {
        const value = await action(epoch);
        if (epoch === this.epoch) this.publish({ value, pending: null, error: null });
      } catch (error) {
        if (epoch === this.epoch)
          this.publish({
            ...this.state,
            pending: null,
            error: error instanceof Error ? error.message : "The project brief request failed.",
          });
      } finally {
        if (epoch === this.epoch) this.active = undefined;
      }
    })();
    this.active = active;
    return active;
  }

  open(generateWhenAbsent: boolean): Promise<void> {
    return this.run("read", async (epoch) => {
      const value = await this.api.get();
      if (epoch !== this.epoch || value.saved !== null || !generateWhenAbsent) return value;
      this.publish({ value, pending: "generate", error: null });
      return this.api.generate();
    });
  }

  generate(): Promise<void> {
    return this.run("generate", () => this.api.generate());
  }

  clear(): Promise<void> {
    return this.run("clear", () => this.api.clear(), true);
  }

  configure(contextFile: string | null): Promise<void> {
    return this.run("configure", () => this.api.configure(contextFile), true);
  }
}
