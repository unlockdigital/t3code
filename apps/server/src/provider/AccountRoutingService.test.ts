import { expect, it } from "@effect/vitest";
import {
  AccountRoutingPolicy,
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { idleThreadProjection, liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as Settings from "../serverSettings.ts";
import * as Routing from "./AccountRoutingService.ts";
import * as Registry from "./ProviderRegistry.ts";

const projectId = ProjectId.make("routing-project");
const selection = { instanceId: ProviderInstanceId.make("codex"), model: "test-model" };
const policy = Schema.decodeSync(AccountRoutingPolicy)({
  schemaVersion: 1,
  policyId: "test",
  revision: 1,
  mode: "observe",
  modelMatch: "exact",
  stages: [{ id: "included", instanceId: "codex", fundingIntent: "includedOnly" }],
  maxEvidenceAgeSeconds: 300,
  minimumHeadroomPercent: 5,
  paidApiFallback: false,
});
const project = {
  projectId,
  title: "Test",
  workspaceRoot: "/private/local-project",
  defaultModelSelection: null,
  defaultThreadEnvMode: null,
  autoPull: false,
  faviconPath: null,
  projectIcon: null,
  scripts: [],
  createdAt: "2026-10-24T00:00:00.000Z",
  updatedAt: "2026-10-24T00:00:00.000Z",
  deletedAt: null,
};
const provider: ServerProvider = {
  instanceId: selection.instanceId,
  driver: ProviderDriverKind.make("codex"),
  installed: true,
  enabled: true,
  status: "ready",
  version: "1",
  checkedAt: "2026-10-24T00:00:00.000Z",
  auth: {
    status: "authenticated",
    email: "private-email@example.invalid",
    workspaceId: "private-workspace",
    profileId: "private-profile",
  },
  runtimePaths: { homePath: "/private/auth-home", shadowHomePath: null },
  message: "private-provider-error",
  models: [{ slug: selection.model, name: "Test", isCustom: false, capabilities: null }],
  slashCommands: [],
  skills: [],
  usageLimits: {
    checkedAt: "2026-10-24T00:00:00.000Z",
    credentialFingerprint: "private-fingerprint",
    windows: [{ id: "primary", kind: "session", label: "Session", usedPercent: 10 }],
    creditBalance: { hasCredits: true, unlimited: false, balance: "100" },
    resetCredits: { availableCount: 1, nextCreditId: "private-reset-credit" },
    externalUsage: { label: "private-billing", url: "https://private.invalid/token" },
  },
};
const dependencies = (settings: ServerSettings, reads: Ref.Ref<number>) =>
  Layer.mergeAll(
    Layer.mock(ProjectionStore.ProjectionStoreV2)({}),
    Layer.mock(Settings.ServerSettingsService)({
      getRoutingSettings: Effect.succeed(settings),
      getSettings: Effect.die("Preview must use settings without materializing secrets"),
    }),
    Layer.mock(Registry.ProviderRegistry)({
      getProviders: Ref.update(reads, (value) => value + 1).pipe(Effect.as([provider])),
      refresh: () => Effect.die("Preview cannot refresh providers"),
      refreshInstance: () => Effect.die("Preview cannot refresh an account"),
    }),
    Layer.mock(ProjectStore.ProjectStoreV2)({
      get: (id) => Effect.succeed(id === projectId ? Option.some(project) : Option.none()),
    }),
  );

it.effect(
  "uses cached evidence, keeps unsupported funding unknown, and returns an allowlisted result",
  () =>
    Effect.gen(function* () {
      const reads = yield* Ref.make(0);
      const result = yield* Routing.AccountRoutingService.use((routing) =>
        routing.preview({ projectId, requestedSelection: selection }),
      ).pipe(
        Effect.provide(
          Routing.layer.pipe(
            Layer.provide(
              dependencies({ ...DEFAULT_SERVER_SETTINGS, accountRouting: policy }, reads),
            ),
          ),
        ),
      );
      expect(result.dispatchAllowed).toBe(false);
      expect(result.activationBlockers).toContain("previewOnly");
      expect(result.target).toBeNull();
      expect(result.policySnapshot).toEqual(policy);
      expect(yield* Ref.get(reads)).toBe(1);
      const encoded = JSON.stringify(result);
      for (const secret of [
        "private-email",
        "private-workspace",
        "private-profile",
        "private-fingerprint",
        "private-reset-credit",
        "private-billing",
        "private-provider-error",
        "/private/",
        "private.invalid",
      ])
        expect(encoded).not.toContain(secret);
    }),
);

it.effect("keeps private requirements authoritative over a caller's optional flag", () =>
  Effect.gen(function* () {
    const reads = yield* Ref.make(0);
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      accountRouting: policy,
      modelPrivacy: "private" as const,
    };
    const result = yield* Routing.AccountRoutingService.use((routing) =>
      routing.preview({ projectId, requestedSelection: selection, requirePrivateRoute: false }),
    ).pipe(Effect.provide(Routing.layer.pipe(Layer.provide(dependencies(settings, reads)))));
    expect(result.target).toBeNull();
    expect(result.dispatchAllowed).toBe(false);
    expect(result.stages.flatMap((stage) => stage.reasons)).toContain("privateRouteRequired");
  }),
);

it.effect(
  "rejects unavailable projects and mismatched trusted thread context before reading providers",
  () =>
    Effect.gen(function* () {
      const reads = yield* Ref.make(0);
      yield* Routing.AccountRoutingService.use((routing) =>
        Effect.gen(function* () {
          const missing = yield* Effect.flip(
            routing.preview({
              projectId: ProjectId.make("missing"),
              requestedSelection: selection,
            }),
          );
          const mismatched = yield* Effect.flip(
            routing.preview(
              { projectId, requestedSelection: selection },
              { projectId: ProjectId.make("other") },
            ),
          );
          expect(missing.reason).toBe("context-unavailable");
          expect(mismatched.reason).toBe("context-unavailable");
        }),
      ).pipe(
        Effect.provide(
          Routing.layer.pipe(Layer.provide(dependencies(DEFAULT_SERVER_SETTINGS, reads))),
        ),
      );
      expect(yield* Ref.get(reads)).toBe(0);
    }),
);

it.effect("honors a saved thread's private route and rejects deleted thread context", () =>
  Effect.gen(function* () {
    const reads = yield* Ref.make(0);
    const threadId = ThreadId.make("saved-private-thread");
    const thread = {
      ...idleThreadProjection(liveThreadShell(threadId)).thread,
      projectId,
      privateModelRoute: {
        modelSelection: {
          instanceId: ProviderInstanceId.make("private-account"),
          model: "tinfoil/test",
        },
        providerConfigHash: "saved-private-connection",
      },
    };
    const service = Routing.layer.pipe(
      Layer.provide(
        Layer.mock(ProjectionStore.ProjectionStoreV2)({ getThread: () => Effect.succeed(thread) }),
      ),
      Layer.provide(dependencies({ ...DEFAULT_SERVER_SETTINGS, accountRouting: policy }, reads)),
    );
    const result = yield* Routing.AccountRoutingService.use((routing) =>
      routing.preview({
        projectId,
        threadId,
        requestedSelection: selection,
        requirePrivateRoute: false,
      }),
    ).pipe(Effect.provide(service));
    expect(result.target).toBeNull();
    expect(result.stages.flatMap((stage) => stage.reasons)).toContain("privateRouteRequired");
    const deletedService = Routing.layer.pipe(
      Layer.provide(
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getThread: () => Effect.succeed({ ...thread, deletedAt: thread.createdAt }),
        }),
      ),
      Layer.provide(dependencies({ ...DEFAULT_SERVER_SETTINGS, accountRouting: policy }, reads)),
    );
    const error = yield* Effect.flip(
      Routing.AccountRoutingService.use((routing) =>
        routing.preview({
          projectId,
          threadId,
          requestedSelection: selection,
        }),
      ).pipe(Effect.provide(deletedService)),
    );
    expect(error.reason).toBe("context-unavailable");
  }),
);
