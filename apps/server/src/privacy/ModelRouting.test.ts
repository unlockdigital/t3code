import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  type OrchestrationV2AppThread,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  type ServerSettings,
  ThreadId,
} from "@t3tools/contracts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ServerSettingsService from "../serverSettings.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as ModelRouting from "./ModelRouting.ts";
import { assertPrivateModelSelection, privateProviderConfigHash } from "./modelRoutingPolicy.ts";

const projectId = ProjectId.make("synthetic-private-project");
const threadId = ThreadId.make("synthetic-private-thread");
const privateSelection = {
  instanceId: ProviderInstanceId.make("opencode-tinfoil"),
  model: "tinfoil/kimi-k3",
};
const cloudSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "synthetic-cloud-model",
};
const instance = {
  driver: ProviderDriverKind.make("opencode"),
  displayName: "Synthetic private connector",
  enabled: true,
  config: { privateInference: "tinfoil", binaryPath: "/synthetic/tinfoil", serverUrl: "" },
} as const;

function privateSettings(): ServerSettings {
  const settings = {
    ...DEFAULT_SERVER_SETTINGS,
    providerInstances: { [privateSelection.instanceId]: instance },
  };
  return {
    ...settings,
    privateModelRoute: {
      modelSelection: privateSelection,
      providerConfigHash: privateProviderConfigHash(settings, privateSelection),
    },
    projectSettingsOverrides: { [projectId]: { modelPrivacy: "private" } },
  };
}

it.effect(
  "blocks cloud destinations, mixed provider/model slugs, disabled connections, and configuration drift",
  () =>
    Effect.gen(function* () {
      const settings = privateSettings();
      const thread = { projectId, privateModelRoute: settings.privateModelRoute! };
      yield* assertPrivateModelSelection(settings, thread, privateSelection);
      yield* assertPrivateModelSelection(settings, thread, {
        ...privateSelection,
        model: "tinfoil/gpt-oss-120b",
      });
      for (const selection of [
        cloudSelection,
        { ...privateSelection, model: "openai/private-looking-name" },
      ]) {
        expect(
          yield* Effect.flip(assertPrivateModelSelection(settings, thread, selection)),
        ).toMatchObject({ reason: "destination-blocked" });
      }
      for (const replacement of [
        { ...instance, enabled: false },
        { ...instance, config: { ...instance.config, binaryPath: "/changed/launcher" } },
        { ...instance, config: { ...instance.config, privateInference: "off" } },
      ]) {
        expect(
          yield* Effect.flip(
            assertPrivateModelSelection(
              { ...settings, providerInstances: { [privateSelection.instanceId]: replacement } },
              thread,
              privateSelection,
            ),
          ),
        ).toMatchObject({ reason: "route-changed" });
      }
    }),
);

it.effect("keeps a thread private after the project default and global route are cleared", () =>
  Effect.gen(function* () {
    const settings = privateSettings();
    const thread = { projectId, privateModelRoute: settings.privateModelRoute! };
    const changed = { ...settings, privateModelRoute: null, projectSettingsOverrides: {} };
    expect(
      yield* Effect.flip(assertPrivateModelSelection(changed, thread, cloudSelection)),
    ).toMatchObject({ reason: "destination-blocked" });
    yield* assertPrivateModelSelection(changed, thread, privateSelection);
  }),
);

it.effect("keeps private inference approval stable when only billing authorization changes", () =>
  Effect.gen(function* () {
    const settings = privateSettings();
    const changed = {
      ...settings,
      providerInstances: {
        ...settings.providerInstances,
        [privateSelection.instanceId]: {
          ...instance,
          config: {
            ...instance.config,
            tinfoilAdminKey: "synthetic-billing-reference",
            tinfoilMonthlyBudgetUsd: 40,
          },
        },
      },
    };
    expect(privateProviderConfigHash(changed, privateSelection)).toBe(
      settings.privateModelRoute?.providerConfigHash,
    );
    yield* assertPrivateModelSelection(
      changed,
      { projectId, privateModelRoute: settings.privateModelRoute! },
      privateSelection,
    );
  }),
);

it.effect("requires a configured private connection when the project is locked", () =>
  Effect.gen(function* () {
    expect(
      yield* Effect.flip(
        assertPrivateModelSelection(
          { ...privateSettings(), privateModelRoute: null },
          { projectId },
          cloudSelection,
        ),
      ),
    ).toMatchObject({ reason: "setup-required" });
  }),
);

const fixture = Effect.fn("ModelRouting.test.fixture")(function* (
  options: { threadPrivate?: boolean; projectPrivate?: boolean } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-private-routing-" });
  const cwd = `${root}/project`;
  const worktree = `${root}/worktree`;
  yield* fs.makeDirectory(cwd);
  yield* fs.makeDirectory(worktree);
  yield* fs.symlink(cwd, `${root}/alias`);
  const now = yield* DateTime.now;
  const settings = privateSettings();
  const thread: OrchestrationV2AppThread = {
    id: threadId,
    projectId,
    title: "Synthetic route test",
    createdBy: "user",
    creationSource: "web",
    providerInstanceId:
      options.threadPrivate === false ? cloudSelection.instanceId : privateSelection.instanceId,
    modelSelection: options.threadPrivate === false ? cloudSelection : privateSelection,
    runtimeMode: "auto",
    interactionMode: "default",
    branch: null,
    worktreePath: worktree,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
    ...(options.threadPrivate === false ? {} : { privateModelRoute: settings.privateModelRoute! }),
  };
  const project: ProjectStore.ProjectRow = {
    projectId,
    title: "Synthetic project",
    workspaceRoot: cwd,
    defaultModelSelection: null,
    defaultThreadEnvMode: null,
    autoPull: false,
    faviconPath: null,
    projectIcon: null,
    scripts: [],
    createdAt: "2026-10-23T00:00:00.000Z",
    updatedAt: "2026-10-23T00:00:00.000Z",
    deletedAt: null,
  };
  const layerSettings = ServerSettingsService.layerTest({
    ...settings,
    ...(options.projectPrivate === false ? { projectSettingsOverrides: {} } : {}),
  });
  const reads = { projects: 0, threads: 0 };
  const layerRouting = Layer.effect(ModelRouting.ModelRouting, ModelRouting.make).pipe(
    Layer.provide(
      Layer.mock(ProjectStore.ProjectStoreV2)({
        list: () =>
          Effect.sync(() => {
            reads.projects++;
            return [project];
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getThread: () =>
          Effect.sync(() => {
            reads.threads++;
            return thread;
          }),
        getPrivateModelRoutingThreads: Effect.succeed(thread.privateModelRoute ? [thread] : []),
      }),
    ),
    Layer.provideMerge(layerSettings),
  );
  return { cwd, root, worktree, thread, reads, layerRouting };
});

it.effect(
  "routes titles, commits, PR text, branch names, and reviews privately and stops when the connection changes",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const calls: Array<{ operation: string; instanceId: string }> = [];
      const generation = (instanceId: string): ProviderTextGeneration => {
        const record = (operation: string) =>
          Effect.sync(() => {
            calls.push({ operation, instanceId });
          });
        return {
          generateThreadTitle: () => record("title").pipe(Effect.as({ title: "Synthetic title" })),
          generateCommitMessage: () =>
            record("commit").pipe(Effect.as({ subject: "Synthetic", body: "" })),
          generatePrContent: () => record("pr").pipe(Effect.as({ title: "Synthetic", body: "" })),
          generateBranchName: () => record("branch").pipe(Effect.as({ branch: "synthetic" })),
          generateReviewGuide: () =>
            record("review").pipe(Effect.as({ summary: "Synthetic", sections: [] } as never)),
        };
      };
      const layerGeneration = Layer.effect(TextGeneration.TextGeneration, TextGeneration.make).pipe(
        Layer.provide(
          Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
            getInstance: (id) =>
              Effect.succeed({ textGeneration: generation(id) } as ProviderInstance),
          }),
        ),
        Layer.provide(
          Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
            resolveLink: () => Effect.die("Private titles must avoid external link expansion"),
          }),
        ),
        Layer.provideMerge(f.layerRouting),
      );
      yield* Effect.gen(function* () {
        const text = yield* TextGeneration.TextGeneration;
        const common = { cwd: f.cwd, modelSelection: cloudSelection };
        yield* text.generateThreadTitle({
          ...common,
          message: "Synthetic title https://example.invalid/private-query",
        });
        yield* text.generateCommitMessage({
          ...common,
          branch: null,
          stagedSummary: "Synthetic",
          stagedPatch: "Synthetic",
        });
        yield* text.generatePrContent({
          ...common,
          baseBranch: "main",
          headBranch: "synthetic",
          commitSummary: "Synthetic",
          diffSummary: "Synthetic",
          diffPatch: "Synthetic",
        });
        yield* text.generateBranchName({ ...common, message: "Synthetic branch" });
        const guide = yield* text.generateReviewGuide({
          ...common,
          number: 1,
          title: "Synthetic",
          description: "Synthetic",
          baseBranch: "main",
          baseCommit: "synthetic",
          settledReview: "Synthetic",
        });
        expect(guide.modelSelection).toEqual(privateSelection);
        expect(calls.map(({ operation }) => operation)).toEqual([
          "title",
          "commit",
          "pr",
          "branch",
          "review",
        ]);
        expect(calls.every(({ instanceId }) => instanceId === privateSelection.instanceId)).toBe(
          true,
        );
        const settings = yield* ServerSettingsService.ServerSettingsService;
        yield* settings.updateProviderInstance({
          operation: "upsert",
          instanceId: privateSelection.instanceId,
          instance: { ...instance, enabled: false },
        });
        expect(
          yield* Effect.flip(
            text.generateThreadTitle({ ...common, message: "Synthetic blocked title" }),
          ),
        ).toMatchObject({ _tag: "TextGenerationError" });
        expect(calls).toHaveLength(5);
      }).pipe(Effect.provide(layerGeneration));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "recognizes project aliases and private worktrees, preserves standard siblings, and rejects mismatched thread context",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* Effect.gen(function* () {
        const routing = yield* ModelRouting.ModelRouting;
        for (const cwd of [f.cwd, `${f.root}/alias`, f.worktree])
          expect(
            (yield* routing.backgroundModel({ cwd, modelSelection: cloudSelection }))
              .modelSelection,
          ).toEqual(privateSelection);
        expect(
          (yield* routing.backgroundModel({ cwd: f.root, modelSelection: cloudSelection })).private,
        ).toBe(false);
        expect(
          yield* Effect.flip(
            routing.backgroundModel({
              cwd: f.cwd,
              threadId,
              projectId: ProjectId.make("wrong-project"),
              modelSelection: cloudSelection,
            }),
          ),
        ).toMatchObject({ reason: "context-unavailable" });
      }).pipe(Effect.provide(f.layerRouting));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "keeps an explicit standard thread fast and unchanged alongside private work in the same workspace",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture({ projectPrivate: false });
      const standard = {
        ...f.thread,
        privateModelRoute: undefined,
        modelSelection: cloudSelection,
        providerInstanceId: cloudSelection.instanceId,
      };
      yield* Effect.gen(function* () {
        const routing = yield* ModelRouting.ModelRouting;
        for (let index = 0; index < 3; index++)
          expect(
            yield* routing.backgroundModel({
              cwd: f.worktree,
              thread: standard,
              threadId,
              modelSelection: cloudSelection,
            }),
          ).toEqual({ modelSelection: cloudSelection, private: false });
        expect(f.reads).toEqual({ projects: 0, threads: 0 });
      }).pipe(Effect.provide(f.layerRouting));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "uses a private thread lock in a standard project and preserves ordinary standard routing",
  () =>
    Effect.gen(function* () {
      const privateThread = yield* fixture({ projectPrivate: false });
      yield* Effect.gen(function* () {
        const routing = yield* ModelRouting.ModelRouting;
        expect(
          (yield* routing.backgroundModel({
            cwd: privateThread.worktree,
            threadId,
            modelSelection: cloudSelection,
          })).private,
        ).toBe(true);
      }).pipe(Effect.provide(privateThread.layerRouting));
      const standard = yield* fixture({ projectPrivate: false, threadPrivate: false });
      yield* Effect.gen(function* () {
        const routing = yield* ModelRouting.ModelRouting;
        expect(
          yield* routing.backgroundModel({ cwd: standard.cwd, modelSelection: cloudSelection }),
        ).toEqual({ modelSelection: cloudSelection, private: false });
        for (let index = 0; index < 3; index++)
          expect(
            (yield* routing.backgroundModel({
              cwd: `${standard.root}/unopened`,
              thread: standard.thread,
              threadId,
              modelSelection: cloudSelection,
            })).modelSelection,
          ).toEqual(cloudSelection);
        expect(standard.reads).toEqual({ projects: 0, threads: 0 });
      }).pipe(Effect.provide(standard.layerRouting));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
