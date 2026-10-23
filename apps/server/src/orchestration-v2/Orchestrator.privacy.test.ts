import { expect, it } from "@effect/vitest";
import {
  CommandId,
  DEFAULT_SERVER_SETTINGS,
  MessageId,
  type OrchestrationV2Command,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { privateProviderConfigHash } from "../privacy/modelRoutingPolicy.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const projectId = ProjectId.make("private-synthetic-project");
const instanceId = ProviderInstanceId.make("opencode-tinfoil");
const selection = { instanceId, model: "tinfoil/kimi-k3" };
const cloud = { instanceId: ProviderInstanceId.make("codex"), model: "synthetic-cloud" };
const settings = {
  ...DEFAULT_SERVER_SETTINGS,
  providerInstances: {
    [instanceId]: {
      driver: ProviderDriverKind.make("opencode"),
      enabled: true,
      config: { privateInference: "tinfoil", serverUrl: "" },
    },
  },
};
const route = {
  modelSelection: selection,
  providerConfigHash: privateProviderConfigHash(settings, selection),
};
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("opencode"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("Synthetic routing tests start no provider processes"),
} satisfies ProviderAdapter.ProviderAdapterV2["Service"];
const database = SqlitePersistence.layerMemory;
const layerTest = Layer.merge(
  ProjectionStore.layer.pipe(Layer.provide(database)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "private-routing" },
    ProviderAdapterRegistry.layerFromAdapters([
      adapter,
      { ...adapter, instanceId: cloud.instanceId, driver: ProviderDriverKind.make("codex") },
    ]),
    {
      databaseLayer: database,
      runEffectWorker: false,
      serverSettings: {
        ...settings,
        privateModelRoute: route,
        projectSettingsOverrides: { [projectId]: { modelPrivacy: "private" } },
      },
    },
  ),
);

const create = (
  id: string,
  overrides: Partial<Extract<OrchestrationV2Command, { type: "thread.create" }>> = {},
) =>
  ({
    type: "thread.create",
    commandId: CommandId.make(`create:${id}`),
    threadId: ThreadId.make(id),
    projectId,
    title: "Synthetic",
    modelSelection: selection,
    runtimeMode: "auto",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdBy: "user",
    creationSource: "web",
    ...overrides,
  }) as Extract<OrchestrationV2Command, { type: "thread.create" }>;

it.effect(
  "persists a project private lock, blocks cloud model changes and messages, and preserves the lock on a fresh child",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const parent = create("private-parent");
      yield* orchestrator.dispatch(parent);
      expect((yield* projections.getThread(parent.threadId)).privateModelRoute).toEqual(route);
      expect((yield* projections.getThreadShell(parent.threadId))?.privateModelRoute).toEqual(
        route,
      );
      for (const command of [
        {
          type: "thread.model-selection.set",
          commandId: CommandId.make("cloud-selection"),
          threadId: parent.threadId,
          modelSelection: cloud,
        },
        {
          type: "provider.switch",
          commandId: CommandId.make("cloud-switch"),
          threadId: parent.threadId,
          modelSelection: cloud,
        },
        {
          type: "message.dispatch",
          commandId: CommandId.make("cloud-message"),
          threadId: parent.threadId,
          messageId: MessageId.make("cloud-message"),
          modelSelection: cloud,
          text: "Synthetic protected content",
          attachments: [],
          dispatchMode: { type: "defer_start" },
          createdBy: "user",
          creationSource: "web",
        },
      ] satisfies Array<OrchestrationV2Command>)
        expect(yield* Effect.flip(orchestrator.dispatch(command))).toMatchObject({
          _tag: "OrchestratorPrivateRoutingError",
          reason: "destination-blocked",
        });
      const child = create("private-child", {
        projectId: ProjectId.make("standard-project"),
        privateRouteSourceThreadId: parent.threadId,
      });
      yield* orchestrator.dispatch({
        type: "thread.metadata.update",
        commandId: CommandId.make("private-parent-helpers-disabled"),
        threadId: parent.threadId,
        privateHelpers: "disabled",
      });
      yield* orchestrator.dispatch(child);
      expect((yield* projections.getThread(child.threadId)).privateModelRoute).toEqual(route);
      expect((yield* projections.getThreadShell(child.threadId))?.privateHelpers).toBe("disabled");
      expect((yield* projections.getThreadProjection(parent.threadId)).messages).toHaveLength(0);
      expect(
        yield* Effect.flip(
          orchestrator.dispatch(create("rejected-cloud-thread", { modelSelection: cloud })),
        ),
      ).toMatchObject({ _tag: "OrchestratorPrivateRoutingError" });
    }).pipe(Effect.provide(layerTest)),
);

it.effect("records an explicit private thread inside a standard project", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const thread = create("explicit-private", {
      projectId: ProjectId.make("ordinary-project"),
      private: true,
    });
    yield* orchestrator.dispatch(thread);
    expect((yield* projections.getThread(thread.threadId)).privateModelRoute).toEqual(route);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("blocks forwarding private context into an unlocked Tinfoil thread", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const source = create("locked-message-source");
    const target = create("standard-tinfoil-target", {
      projectId: ProjectId.make("ordinary-project"),
    });
    yield* orchestrator.dispatch(source);
    yield* orchestrator.dispatch(target);
    expect((yield* projections.getThread(target.threadId)).privateModelRoute).toBeUndefined();
    expect(
      yield* Effect.flip(
        orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("private-forward"),
          threadId: target.threadId,
          senderThreadId: source.threadId,
          messageId: MessageId.make("private-forward"),
          modelSelection: selection,
          text: "INVENTED_PRIVATE_FORWARD_CANARY",
          attachments: [],
          dispatchMode: { type: "defer_start" },
          createdBy: "agent",
          creationSource: "mcp",
        }),
      ),
    ).toMatchObject({ _tag: "OrchestratorPrivateRoutingError", reason: "destination-blocked" });
    expect((yield* projections.getThreadProjection(target.threadId)).messages).toHaveLength(0);
  }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "enables privacy explicitly on an empty draft and keeps helper controls scoped to private work",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const draft = create("explicit-private-draft", {
        projectId: ProjectId.make("ordinary-project"),
        modelSelection: cloud,
      });
      yield* orchestrator.dispatch(draft);
      expect(
        yield* Effect.flip(
          orchestrator.dispatch({
            type: "thread.metadata.update",
            commandId: CommandId.make("reject-standard-helpers"),
            threadId: draft.threadId,
            privateHelpers: "review",
          }),
        ),
      ).toMatchObject({ reason: "destination-blocked" });
      yield* orchestrator.dispatch({
        type: "thread.metadata.update",
        commandId: CommandId.make("enable-private-draft"),
        threadId: draft.threadId,
        modelPrivacy: "private",
        privateHelpers: "disabled",
      });
      expect(yield* projections.getThread(draft.threadId)).toMatchObject({
        privateModelRoute: route,
        modelSelection: selection,
        privateHelpers: "disabled",
        runtimeMode: "auto",
      });
      yield* orchestrator.dispatch({
        type: "thread.metadata.update",
        commandId: CommandId.make("review-private-helpers"),
        threadId: draft.threadId,
        privateHelpers: "review",
      });
      expect((yield* projections.getThreadShell(draft.threadId))?.privateHelpers).toBe("review");
    }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "keeps Standard threads and action permissions unchanged when choosing Tinfoil inference",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const standard = create("standard-cloud", {
        projectId: ProjectId.make("ordinary-project"),
        modelSelection: cloud,
      });
      yield* orchestrator.dispatch(standard);
      const stored = yield* projections.getThread(standard.threadId);
      expect(stored.modelSelection).toEqual(cloud);
      expect(stored.runtimeMode).toBe("auto");
      expect(stored.privateModelRoute).toBeUndefined();
      expect(stored.privateWorkspacePaths).toBeUndefined();
      const tinfoil = create("selected-tinfoil", { projectId: standard.projectId });
      yield* orchestrator.dispatch(tinfoil);
      expect((yield* projections.getThread(tinfoil.threadId)).privateModelRoute).toBeUndefined();
    }).pipe(Effect.provide(layerTest)),
);

it.effect("allows Tinfoil selection in a Standard draft while preserving its workflow", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const draft = create("private-draft-selection", {
      projectId: ProjectId.make("ordinary-project"),
      modelSelection: cloud,
    });
    yield* orchestrator.dispatch(draft);
    yield* orchestrator.dispatch({
      type: "thread.model-selection.set",
      commandId: CommandId.make("private-draft-selection"),
      threadId: draft.threadId,
      modelSelection: selection,
    });
    expect(yield* projections.getThread(draft.threadId)).toMatchObject({
      modelSelection: selection,
      runtimeMode: "auto",
    });
    expect((yield* projections.getThread(draft.threadId)).privateModelRoute).toBeUndefined();
  }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "dispatches a Standard draft through Tinfoil without imposing a private workflow lock",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const draft = create("private-draft-message", {
        projectId: ProjectId.make("ordinary-project"),
        modelSelection: cloud,
      });
      yield* orchestrator.dispatch(draft);
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("private-draft-message"),
        threadId: draft.threadId,
        messageId: MessageId.make("private-draft-message"),
        modelSelection: selection,
        text: "Synthetic private task",
        attachments: [],
        dispatchMode: { type: "defer_start" },
        createdBy: "user",
        creationSource: "web",
      });
      expect(yield* projections.getThread(draft.threadId)).toMatchObject({
        modelSelection: selection,
      });
      expect((yield* projections.getThread(draft.threadId)).privateModelRoute).toBeUndefined();
      const projection = yield* projections.getThreadProjection(draft.threadId);
      expect(projection.messages).toHaveLength(1);
      expect(projection.runs).toHaveLength(1);
    }).pipe(Effect.provide(layerTest)),
);

it.effect("allows an existing Standard conversation to use Tinfoil and switch back", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const thread = create("standard-with-history", {
      projectId: ProjectId.make("ordinary-project"),
      modelSelection: cloud,
    });
    yield* orchestrator.dispatch(thread);
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("standard-with-history"),
      threadId: thread.threadId,
      messageId: MessageId.make("standard-with-history"),
      text: "Synthetic cloud task",
      attachments: [],
      dispatchMode: { type: "defer_start" },
      createdBy: "user",
      creationSource: "web",
    });
    yield* orchestrator.dispatch({
      type: "thread.model-selection.set",
      commandId: CommandId.make("existing-history-tinfoil"),
      threadId: thread.threadId,
      modelSelection: selection,
    });
    expect((yield* projections.getThread(thread.threadId)).privateModelRoute).toBeUndefined();
    yield* orchestrator.dispatch({
      type: "thread.model-selection.set",
      commandId: CommandId.make("existing-history-cloud"),
      threadId: thread.threadId,
      modelSelection: cloud,
    });
    const stored = yield* projections.getThread(thread.threadId);
    expect(stored.modelSelection).toEqual(cloud);
    expect(stored.privateModelRoute).toBeUndefined();
    expect((yield* projections.getThreadProjection(thread.threadId)).messages).toHaveLength(1);
    expect(
      yield* Effect.flip(
        orchestrator.dispatch({
          type: "thread.metadata.update",
          commandId: CommandId.make("reject-used-private-label"),
          threadId: thread.threadId,
          modelPrivacy: "private",
        }),
      ),
    ).toMatchObject({ reason: "fresh-thread-required" });
  }).pipe(Effect.provide(layerTest)),
);
