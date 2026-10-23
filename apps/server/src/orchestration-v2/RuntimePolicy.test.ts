import { assert, it } from "@effect/vitest";
import {
  type ModelSelection,
  type OrchestrationV2AppThread,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  type RuntimeMode,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as RuntimePolicy from "./RuntimePolicy.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ModelRouting from "../privacy/ModelRouting.ts";
import { privateProviderConfigHash } from "../privacy/modelRoutingPolicy.ts";

const projectId = ProjectId.make("project:runtime-policy");
const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = {
  instanceId: providerInstanceId,
  model: "gpt-5.5",
} satisfies ModelSelection;

function makeThread(input: {
  readonly now: DateTime.Utc;
  readonly worktreePath: string | null;
  readonly runtimeMode?: RuntimeMode;
}): OrchestrationV2AppThread {
  const threadId = ThreadId.make("thread:runtime-policy");
  return {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId,
    title: "Runtime policy",
    providerInstanceId,
    modelSelection,
    runtimeMode: input.runtimeMode ?? "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: input.worktreePath,
    activeProviderThreadId: null,
    lineage: {
      parentThreadId: null,
      relationshipToParent: null,
      rootThreadId: threadId,
    },
    forkedFrom: null,
    createdAt: input.now,
    updatedAt: input.now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

const grokInstanceId = ProviderInstanceId.make("grok");
const supportedRuntimeModesByInstance = new Map<ProviderInstanceId, ReadonlyArray<RuntimeMode>>([
  [grokInstanceId, ["approval-required", "auto", "full-access"]],
]);
const providerInstanceFor = (instanceId: ProviderInstanceId) =>
  ({
    snapshot: {
      getSnapshot: Effect.succeed({
        supportedRuntimeModes: supportedRuntimeModesByInstance.get(instanceId),
      } as ServerProvider),
    },
  }) as ProviderInstance;

const layerTest = RuntimePolicy.layerFromProjectStore.pipe(
  Layer.provide(
    Layer.mock(ModelRouting.ModelRouting)({
      backgroundModel: (input) =>
        Effect.succeed({ modelSelection: input.modelSelection, private: false }),
    }),
  ),
  Layer.provideMerge(ServerSettings.layerTest()),
  Layer.provide(
    Layer.succeed(ProviderInstanceRegistry.ProviderInstanceRegistry, {
      getInstance: (instanceId) => Effect.succeed(providerInstanceFor(instanceId)),
      listInstances: Effect.succeed([]),
      listUnavailable: Effect.succeed([]),
      streamChanges: Stream.empty,
      subscribeChanges: Effect.never,
    }),
  ),
  Layer.provide(
    Layer.mock(ProjectStore.ProjectStoreV2)({
      get: () =>
        Effect.succeed(
          Option.some({
            projectId,
            title: "Project",
            workspaceRoot: "/project-root",
            defaultModelSelection: null,
            defaultThreadEnvMode: null,
            autoPull: false,
            faviconPath: null,
            projectIcon: null,
            scripts: [],
            createdAt: "2026-06-21T00:00:00.000Z",
            updatedAt: "2026-06-21T00:00:00.000Z",
            deletedAt: null,
          }),
        ),
    }),
  ),
);

it.layer(layerTest)("RuntimePolicyV2", (it) => {
  it.effect("runs Tinfoil in a Standard thread with its existing Auto permissions", () =>
    Effect.gen(function* () {
      const settings = yield* ServerSettings.ServerSettingsService;
      const instanceId = ProviderInstanceId.make("synthetic-tinfoil");
      const selection = { instanceId, model: "tinfoil/kimi-k3" };
      const current = yield* settings.updateSettings({
        providerInstances: {
          [instanceId]: {
            driver: ProviderDriverKind.make("opencode"),
            enabled: true,
            config: { privateInference: "tinfoil", serverUrl: "" },
          },
        },
      });
      yield* settings.updateSettings({
        privateModelRoute: {
          modelSelection: selection,
          providerConfigHash: privateProviderConfigHash(current, selection),
        },
      });
      const policy = yield* RuntimePolicy.RuntimePolicyV2;
      const now = yield* DateTime.now;
      const result = yield* policy.resolve({
        thread: makeThread({ now, worktreePath: null, runtimeMode: "auto" }),
        modelSelection: selection,
      });
      assert.equal(result.runtimeMode, "auto");
      assert.equal(result.cwd, "/project-root");
    }),
  );
  it.effect("blocks a cloud runtime for a thread with a durable private route", () =>
    Effect.gen(function* () {
      const policy = yield* RuntimePolicy.RuntimePolicyV2;
      const now = yield* DateTime.now;
      const thread = {
        ...makeThread({ now, worktreePath: null }),
        privateModelRoute: {
          modelSelection: {
            instanceId: ProviderInstanceId.make("opencode-tinfoil"),
            model: "tinfoil/kimi-k3",
          },
          providerConfigHash: "a".repeat(64),
        },
      };
      const result = yield* Effect.result(policy.resolve({ thread, modelSelection }));
      assert.equal(result._tag, "Failure");
    }),
  );

  it.effect(
    "blocks a cloud runtime for an existing thread after its project requires privacy",
    () =>
      Effect.gen(function* () {
        const settings = yield* ServerSettings.ServerSettingsService;
        yield* settings.updateSettings({
          projectSettingsOverrides: { [projectId]: { modelPrivacy: "private" } },
        });
        const policy = yield* RuntimePolicy.RuntimePolicyV2;
        const now = yield* DateTime.now;
        const result = yield* Effect.result(
          policy.resolve({
            thread: makeThread({ now, worktreePath: "/worktree" }),
            modelSelection,
          }),
        );
        yield* settings.updateSettings({
          projectSettingsOverrides: { [projectId]: { modelPrivacy: "standard" } },
        });
        assert.equal(result._tag, "Failure");
      }),
  );
  it.effect("runs a mode the provider does not offer in Supervised", () =>
    Effect.gen(function* () {
      const policy = yield* RuntimePolicy.RuntimePolicyV2;
      const now = yield* DateTime.now;
      const modeFor = (instanceId: ProviderInstanceId, runtimeMode: RuntimeMode) =>
        policy
          .resolve({
            thread: makeThread({ now, worktreePath: null, runtimeMode }),
            modelSelection: { instanceId, model: "test-model" },
          })
          .pipe(Effect.map((resolved) => resolved.runtimeMode));

      assert.equal(yield* modeFor(grokInstanceId, "auto-accept-edits"), "approval-required");
      assert.equal(yield* modeFor(grokInstanceId, "auto"), "auto");
      assert.equal(yield* modeFor(grokInstanceId, "full-access"), "full-access");
      assert.equal(yield* modeFor(providerInstanceId, "auto-accept-edits"), "auto-accept-edits");
    }),
  );
});
