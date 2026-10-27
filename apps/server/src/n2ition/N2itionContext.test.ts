// @effect-diagnostics nodeBuiltinImport:off -- Synthetic credential binding fixtures.
import * as NodeCrypto from "node:crypto";
import * as NodePlatformCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AccountRoutingPolicy,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ServerSettings,
} from "@t3tools/contracts";
import {
  N2itionConnectionError,
  N2itionGrant,
  N2itionStatus,
  type N2itionControlInput,
} from "@t3tools/contracts/n2itionConnection";
import { expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import { providerConfigurationHash } from "@t3tools/shared/providerConfigurationHash";
import { privateProviderConfigHash } from "../privacy/modelRoutingPolicy.ts";
import * as Settings from "../serverSettings.ts";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadCommandExecutor from "../orchestration-v2/ThreadCommandExecutor.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as N2itionContext from "./N2itionContext.ts";
import * as GrantStore from "./N2itionGrantStore.ts";
import * as Transport from "./N2itionTransport.ts";
import { n2itionSourceCredentialHash } from "./routeConsent.ts";
import type { McpInvocationScope } from "../mcp/McpInvocationContext.ts";

const environmentId = EnvironmentId.make("synthetic-environment");
const threadId = ThreadId.make("synthetic-thread");
const providerInstanceId = ProviderInstanceId.make("synthetic-provider");
const model = "synthetic-model";
const token = new Uint8Array(32).fill(7);
const accountRoutingPolicy = Schema.decodeSync(AccountRoutingPolicy)({
  schemaVersion: 1,
  policyId: "synthetic-policy",
  revision: 1,
  mode: "observe",
  modelMatch: "exact",
  stages: [
    { id: "synthetic-stage", instanceId: providerInstanceId, fundingIntent: "includedOnly" },
  ],
  maxEvidenceAgeSeconds: 300,
  minimumHeadroomPercent: 5,
  paidApiFallback: false,
});
const encodeStatus = Schema.encodeEffect(N2itionStatus);
const input = { window: "all", includeNotes: false, offset: 0 } as const;

const task = {
  id: "synthetic-task",
  title: "Synthetic task content",
  notes: null,
  priority: "medium",
  status: "pending",
  dueDate: null,
  timeBand: null,
  domain: null,
  sortOrder: 0,
  snoozedUntil: null,
  completedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  contextType: "none",
  recurrenceSeriesId: null,
  recurrenceInstanceDueDate: null,
  recurrenceSequence: null,
} as const;
const digest = "2e0a99c01d8a21e018a386bce6a4abc2c9230047509e322311fcebe4f1e731ee";
const iso = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));

type FixtureOptions = {
  grant?: Partial<N2itionGrant>;
  live?: boolean;
  legacy?: boolean;
  missingBoundary?: boolean;
  thread?: {
    deletedAt: string | null;
    archivedAt: string | null;
    providerInstanceId: typeof providerInstanceId;
    modelSelection: { instanceId: typeof providerInstanceId; model: string };
    activeRunId: string | null;
  };
  transportEffect?: (
    input: Parameters<Transport.N2itionTransport["Service"]["snapshot"]>[0],
  ) => Effect.Effect<string, N2itionConnectionError>;
  serverEnvironmentId?: typeof environmentId;
};

const fixture = Effect.fn("N2itionContext.test.fixture")(function* (options: FixtureOptions = {}) {
  const now = yield* DateTime.now;
  const nowMillis = DateTime.toEpochMillis(now);
  const selection = {
    instanceId: providerInstanceId,
    model: options.live ? "tinfoil/synthetic-model" : model,
  };
  const projectId = ProjectId.make("synthetic-project");
  let currentSettings: ServerSettings = {
    ...DEFAULT_SERVER_SETTINGS,
    providerInstances: {
      [providerInstanceId]: {
        driver: ProviderDriverKind.make("opencode"),
        enabled: true,
        config: { privateInference: "tinfoil", serverUrl: "", binaryPath: "synthetic-opencode" },
      },
    },
  };
  currentSettings = {
    ...currentSettings,
    privateModelRoute: {
      modelSelection: selection,
      providerConfigHash: privateProviderConfigHash(currentSettings, selection),
    },
  };
  let effectiveSettings: ServerSettings | undefined;
  const routeFiles = [{ path: "/synthetic/account-route.json", fingerprint: "1:10:1000" }];
  const grant: N2itionGrant = {
    version: 1,
    environmentId,
    threadId,
    providerInstanceId,
    model,
    source: "synthetic",
    origin: "http://127.0.0.1/",
    mode: "active",
    epoch: 4,
    expiresAt: iso(nowMillis + 24 * 60 * 60 * 1000),
    cadenceHours: 1,
    privacyVerified: false,
    sharedProcessAccepted: false,
    routeFiles: [],
    ...(options.live && !options.legacy
      ? {
          sourceCredentialHash: NodeCrypto.createHmac("sha256", token)
            .update(
              JSON.stringify([
                "n2ition-source-v1",
                environmentId,
                "https://n2ition.unlockdigitalmedia.com",
              ]),
            )
            .digest("hex"),
        }
      : {}),
    ...(options.live
      ? {
          model: selection.model,
          source: "live" as const,
          origin: "https://n2ition.unlockdigitalmedia.com",
          privacyVerified: true,
          sharedProcessAccepted: true,
          routeFiles,
          ...(options.legacy
            ? {}
            : {
                routeBinding: {
                  providerConfigHash: providerConfigurationHash(
                    currentSettings.providerInstances[providerInstanceId],
                  ),
                  accountRouteHash: providerConfigurationHash({
                    projectId,
                    modelSelection: selection,
                    privateRoute: currentSettings.privateModelRoute,
                    accountRouting: currentSettings.accountRouting,
                    routeFiles,
                  }),
                },
              }),
        }
      : {}),
    ...options.grant,
  };
  let currentGrant = grant;
  let currentThread = options.thread ?? {
    projectId,
    deletedAt: null,
    archivedAt: null,
    providerInstanceId,
    modelSelection: selection,
    activeRunId: "synthetic-run",
  };
  let remote = options.transportEffect;
  const calls: Array<Parameters<Transport.N2itionTransport["Service"]["snapshot"]>[0]> = [];
  const defaultSnapshot = JSON.stringify({
    version: 1,
    source: options.live ? "live" : "synthetic",
    generatedAt: iso(nowMillis),
    expiresAt: iso(nowMillis + 60 * 60 * 1000),
    digest,
    epoch: 0,
    complete: true,
    timezone: "America/Chicago",
    tasks: [task],
  });
  let threadReadHook = Effect.void;
  let settingsReadHook = Effect.void;
  let routeValid = true;
  let currentToken: Uint8Array | null = token;
  let tokenReadHook = Effect.void;
  const grantService = GrantStore.N2itionGrantStore.of({
    read: Effect.sync(() => currentGrant),
    control: (control: N2itionControlInput) =>
      Effect.sync(() => {
        currentGrant = {
          ...currentGrant,
          mode:
            control.action === "pause"
              ? "paused"
              : control.action === "resume"
                ? "active"
                : "revoked",
          epoch: currentGrant.epoch + 1,
        };
        return currentGrant;
      }),
    withConsent: (expected, use) =>
      Effect.gen(function* () {
        try {
          GrantStore.validateGrant(currentGrant, nowMillis);
        } catch (error) {
          return yield* error as N2itionConnectionError;
        }
        if (providerConfigurationHash(expected) !== providerConfigurationHash(currentGrant))
          return yield* new N2itionConnectionError({ reason: "changed" });
        if (
          !routeValid ||
          !currentToken ||
          (currentGrant.source === "live" &&
            n2itionSourceCredentialHash(currentToken, currentGrant) !==
              currentGrant.sourceCredentialHash)
        )
          return yield* new N2itionConnectionError({ reason: "route_changed" });
        return yield* use(currentToken);
      }),
    checkRouteFiles: () =>
      Effect.suspend(() =>
        routeValid
          ? Effect.void
          : Effect.fail(new N2itionConnectionError({ reason: "route_changed" })),
      ),
  });
  const transportService = Transport.N2itionTransport.of({
    snapshot: (request) =>
      Effect.suspend(() => {
        calls.push(request);
        return remote ? remote(request) : Effect.succeed(defaultSnapshot);
      }),
  });
  const threadService = ThreadManagement.ThreadManagementService.of({
    getThreadShell: () =>
      Effect.gen(function* () {
        const captured = currentThread;
        yield* threadReadHook;
        return captured as never;
      }),
  } as unknown as ThreadManagement.ThreadManagementService["Service"]);
  let beforeTokenRead = () => {};
  const secretService = ServerSecretStore.ServerSecretStore.of({
    get: () =>
      Effect.gen(function* () {
        beforeTokenRead();
        const captured = currentToken;
        yield* tokenReadHook;
        return Option.fromNullishOr(captured);
      }),
  } as unknown as ServerSecretStore.ServerSecretStore["Service"]);
  const environment = ServerEnvironment.ServerEnvironment.of({
    getEnvironmentId: Effect.succeed(options.serverEnvironmentId ?? environmentId),
    getDescriptor: Effect.die("unused descriptor"),
  });
  const platform = Layer.mergeAll(
    NodeServices.layer,
    NodeFileSystem.layer,
    NodePlatformCrypto.layer,
    NodePath.layer,
  );
  let afterUsageWrite = () => {};
  let usageWriteHook = Effect.void;
  const hookedPlatform = Layer.effect(
    FileSystem.FileSystem,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return FileSystem.FileSystem.of({
        ...fs,
        rename: (from, to) =>
          fs.rename(from, to).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                if (to.endsWith("n2ition-usage.json")) afterUsageWrite();
              }),
            ),
            Effect.tap(() => (to.endsWith("n2ition-usage.json") ? usageWriteHook : Effect.void)),
          ),
      });
    }),
  ).pipe(Layer.provideMerge(platform));
  const { withConsent: _boundary, ...legacyGrantService } = grantService;
  const dependencies = Layer.mergeAll(
    ThreadCommandExecutor.layer,
    Layer.mock(Settings.ServerSettingsService)({
      withSettingsSnapshot: (use) =>
        Effect.suspend(() => use(effectiveSettings ?? currentSettings)),
      getRoutingSettings: Effect.sync(() => currentSettings),
      getSettings: Effect.gen(function* () {
        const captured = effectiveSettings ?? currentSettings;
        yield* settingsReadHook;
        return captured;
      }),
    }),
    Layer.succeed(
      GrantStore.N2itionGrantStore,
      options.missingBoundary ? legacyGrantService : grantService,
    ),
    Layer.succeed(Transport.N2itionTransport, transportService),
    Layer.succeed(ThreadManagement.ThreadManagementService, threadService),
    Layer.succeed(ServerSecretStore.ServerSecretStore, secretService),
    Layer.succeed(ServerEnvironment.ServerEnvironment, environment),
    ServerConfig.layerTest(process.cwd(), { prefix: "n2ition-context-test-" }).pipe(
      Layer.provideMerge(hookedPlatform),
    ),
  );
  const layer = Layer.effect(N2itionContext.N2itionContext, N2itionContext.make).pipe(
    Layer.provide(dependencies),
  );
  const scope = (overrides: Partial<McpInvocationScope> = {}): McpInvocationScope => ({
    environmentId,
    capabilities: new Set(["n2ition-read"]),
    issuedAt: nowMillis,
    n2itionGrantEpoch: grant.epoch,
    requestNamespace: "synthetic-request",
    thread: { threadId, providerSessionId: "synthetic-session", providerInstanceId },
    client: undefined,
    ...overrides,
  });
  return {
    layer,
    calls,
    scope,
    setUsageWriteHook: (hook: Effect.Effect<void>) => {
      usageWriteHook = hook;
    },
    getGrant: () => currentGrant,
    setGrant: (next: N2itionGrant) => {
      currentGrant = next;
    },
    setToken: (value: Uint8Array | null) => {
      currentToken = value;
    },
    setTokenReadHook: (hook: Effect.Effect<void>) => {
      tokenReadHook = hook;
    },
    setThreadReadHook: (hook: Effect.Effect<void>) => {
      threadReadHook = hook;
    },
    setSettingsReadHook: (hook: Effect.Effect<void>) => {
      settingsReadHook = hook;
    },
    changeRouteFile: () => {
      routeValid = false;
    },
    changeThreadRoute: () => {
      currentThread = {
        ...currentThread,
        modelSelection: { instanceId: providerInstanceId, model: "changed-model" },
      };
    },
    setTransport: (next: typeof remote) => {
      remote = next;
    },
    nowMillis,
    defaultSnapshot,
    getSettings: () => currentSettings,
    setSettings: (next: ServerSettings) => {
      currentSettings = next;
    },
    setBeforeTokenRead: (next: () => void) => {
      beforeTokenRead = next;
    },
    setEffectiveSettings: (next: ServerSettings) => {
      effectiveSettings = next;
    },
    setAfterUsageWrite: (next: () => void) => {
      afterUsageWrite = next;
    },
  };
});

const readError = (effect: Effect.Effect<unknown, N2itionConnectionError>) =>
  effect.pipe(
    Effect.matchEffect({
      onFailure: Effect.succeed,
      onSuccess: () => Effect.die("Expected rejection"),
    }),
  );

it.effect(
  "rejects wrong scope, thread, provider, epoch, and server environment before transport",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* Effect.gen(function* () {
        const service = yield* N2itionContext.N2itionContext;
        const invalidScopes = [
          f.scope({ environmentId: EnvironmentId.make("other-environment") }),
          f.scope({
            thread: {
              threadId: ThreadId.make("other-thread"),
              providerSessionId: "synthetic-session",
              providerInstanceId,
            },
          }),
          f.scope({
            thread: {
              threadId,
              providerSessionId: "synthetic-session",
              providerInstanceId: ProviderInstanceId.make("other-provider"),
            },
          }),
          f.scope({ n2itionGrantEpoch: 3 }),
          f.scope({ capabilities: new Set() }),
        ];
        for (const scope of invalidScopes) {
          expect((yield* readError(service.read(scope, input))).reason).toBe("unauthorized");
        }
        expect(f.calls).toHaveLength(0);
      }).pipe(Effect.provide(f.layer));

      const wrongEnvironment = yield* fixture({
        serverEnvironmentId: EnvironmentId.make("different-server"),
      });
      yield* Effect.gen(function* () {
        const service = yield* N2itionContext.N2itionContext;
        expect((yield* readError(service.read(wrongEnvironment.scope(), input))).reason).toBe(
          "unauthorized",
        );
        expect(wrongEnvironment.calls).toHaveLength(0);
      }).pipe(Effect.provide(wrongEnvironment.layer));
    }),
);

it.effect("fails closed for paused grants and changed thread routes", () =>
  Effect.gen(function* () {
    const paused = yield* fixture({ grant: { mode: "paused" } });
    yield* Effect.gen(function* () {
      const service = yield* N2itionContext.N2itionContext;
      expect((yield* readError(service.read(paused.scope(), input))).reason).toBe("paused");
      yield* service.sweep;
      expect(paused.calls).toHaveLength(0);
    }).pipe(Effect.provide(paused.layer));

    const routed = yield* fixture({
      thread: {
        deletedAt: null,
        archivedAt: null,
        providerInstanceId,
        modelSelection: { instanceId: providerInstanceId, model: "different-model" },
        activeRunId: null,
      },
    });
    yield* Effect.gen(function* () {
      const service = yield* N2itionContext.N2itionContext;
      expect((yield* readError(service.read(routed.scope(), input))).reason).toBe("route_changed");
      expect(routed.calls).toHaveLength(0);
    }).pipe(Effect.provide(routed.layer));
  }),
);

it.effect(
  "accepts a valid synthetic snapshot and rejects digest, source, and expiry violations",
  () =>
    Effect.gen(function* () {
      const valid = yield* fixture();
      yield* Effect.gen(function* () {
        const service = yield* N2itionContext.N2itionContext;
        const result = yield* service.read(valid.scope(), input);
        expect(result.tasks.map(({ id }) => id)).toEqual(["synthetic-task"]);
        expect(result.checkedAt).toBeTruthy();
        const status = yield* service.status;
        expect(status.taskCount).toBe(1);
        expect(status.source).toBe("synthetic");
        expect(status.usage.backgroundModelCalls).toBe(0);
      }).pipe(Effect.provide(valid.layer));

      const badSnapshots = [
        {
          reason: "invalid_data",
          update: (snapshot: Record<string, unknown>) => ({ ...snapshot, digest: "0".repeat(64) }),
        },
        {
          reason: "invalid_data",
          update: (snapshot: Record<string, unknown>) => ({ ...snapshot, source: "live" }),
        },
        {
          reason: "expired",
          update: (snapshot: Record<string, unknown>) => ({
            ...snapshot,
            generatedAt: iso(valid.nowMillis - 2 * 60 * 60 * 1000),
            expiresAt: iso(valid.nowMillis - 60 * 60 * 1000),
          }),
        },
      ] as const;
      for (const testCase of badSnapshots) {
        const f = yield* fixture({
          transportEffect: () =>
            Effect.succeed(
              JSON.stringify(
                testCase.update(
                  JSON.parse(
                    JSON.stringify({
                      version: 1,
                      source: "synthetic",
                      generatedAt: iso(valid.nowMillis),
                      expiresAt: iso(valid.nowMillis + 60 * 60 * 1000),
                      digest,
                      epoch: 0,
                      complete: true,
                      timezone: "America/Chicago",
                      tasks: [task],
                    }),
                  ),
                ),
              ),
            ),
        });
        yield* Effect.gen(function* () {
          const service = yield* N2itionContext.N2itionContext;
          expect((yield* readError(service.read(f.scope(), input))).reason).toBe(testCase.reason);
          expect((yield* service.status).taskCount).toBe(0);
        }).pipe(Effect.provide(f.layer));
      }
    }),
);

it.effect(
  "clears cached context after a remote failure and reports only content-free counters",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* Effect.gen(function* () {
        const service = yield* N2itionContext.N2itionContext;
        yield* service.read(f.scope(), input);
        f.setTransport(() => Effect.fail(new N2itionConnectionError({ reason: "unavailable" })));
        expect((yield* readError(service.read(f.scope(), input))).reason).toBe("unavailable");
        const status = yield* service.status;
        expect(status.taskCount).toBe(0);
        expect(status.state).toBe("unavailable");
        expect(status.usage).toEqual(
          expect.objectContaining({ reads: 1, refreshes: 1, failures: 1, backgroundModelCalls: 0 }),
        );
        expect(JSON.stringify(status)).not.toContain("Synthetic task content");
        expect(JSON.stringify(status)).not.toContain("n2ition-read-token");
      }).pipe(Effect.provide(f.layer));
    }),
);

it.effect("discards an in-flight snapshot when the grant is revoked", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const f = yield* fixture();
    f.setTransport(() =>
      Effect.gen(function* () {
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(release);
        return JSON.stringify({
          version: 1,
          source: "synthetic",
          generatedAt: iso(f.nowMillis),
          expiresAt: iso(f.nowMillis + 60 * 60 * 1000),
          digest,
          epoch: 0,
          complete: true,
          timezone: "America/Chicago",
          tasks: [task],
        });
      }),
    );
    yield* Effect.gen(function* () {
      const service = yield* N2itionContext.N2itionContext;
      const running = yield* Effect.forkChild(service.read(f.scope(), input));
      yield* Deferred.await(entered);
      yield* service.control({ action: "revoke", expectedEpoch: f.getGrant().epoch });
      yield* Deferred.succeed(release, undefined);
      const error = yield* readError(Fiber.join(running));
      expect(error.reason).toBe("revoked");
      const status = yield* service.status;
      expect(status.localMode).toBe("revoked");
      expect(status.taskCount).toBe(0);
    }).pipe(Effect.provide(f.layer));
  }),
);

it.effect("sweeps active grants with automatic reads and performs no model calls", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* Effect.gen(function* () {
      const service = yield* N2itionContext.N2itionContext;
      yield* service.sweep;
      expect(f.calls.map(({ purpose }) => purpose)).toEqual(["automatic"]);
      const status = yield* service.status;
      expect(status.usage.backgroundModelCalls).toBe(0);
    }).pipe(Effect.provide(f.layer));
  }),
);

it.effect("rejects stale status credentials after pause and revoke", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* Effect.gen(function* () {
      const service = yield* N2itionContext.N2itionContext;
      expect((yield* service.callerStatus(f.scope())).localMode).toBe("active");
      yield* service.control({ action: "pause", expectedEpoch: 4 });
      expect((yield* readError(service.callerStatus(f.scope()))).reason).toBe("unauthorized");
      yield* service.control({ action: "revoke", expectedEpoch: 5 });
      expect((yield* readError(service.callerStatus(f.scope()))).reason).toBe("unauthorized");
      expect((yield* service.status).localMode).toBe("revoked");
    }).pipe(Effect.provide(f.layer));
  }),
);

it.effect("bounds reads per turn and rejects pages from a different snapshot", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* Effect.gen(function* () {
      const service = yield* N2itionContext.N2itionContext;
      expect((yield* readError(service.read(f.scope(), { ...input, offset: 1 }))).reason).toBe(
        "changed",
      );
      expect(
        (yield* readError(
          service.read(f.scope(), { ...input, offset: 1, expectedDigest: "0".repeat(64) }),
        )).reason,
      ).toBe("changed");
      for (let i = 0; i < 10; i++) yield* service.read(f.scope(), input);
      expect((yield* readError(service.read(f.scope(), input))).reason).toBe("rate_limited");
      expect(f.calls).toHaveLength(12);
    }).pipe(Effect.provide(f.layer));
  }),
);

it.effect("encodes owner status through the RPC response schema", () =>
  Effect.gen(function* () {
    const f = yield* fixture({ grant: { mode: "paused" } });
    yield* Effect.gen(function* () {
      const service = yield* N2itionContext.N2itionContext;
      const status = yield* service.status;
      const encoded = yield* encodeStatus(status);
      expect(encoded.state).toBe("paused");
      expect(encoded.taskCount).toBe(0);
    }).pipe(Effect.provide(f.layer));
  }),
);

const changeProviderConfiguration = (f: {
  getSettings: () => ServerSettings;
  setSettings: (settings: ServerSettings) => void;
}) => {
  const settings = f.getSettings();
  const instance = settings.providerInstances[providerInstanceId]!;
  const changed = {
    ...settings,
    providerInstances: {
      ...settings.providerInstances,
      [providerInstanceId]: {
        ...instance,
        environment: [{ name: "ACCOUNT_ROUTE", value: "changed", sensitive: false }],
      },
    },
  };
  // A separately renewed private-route approval still requires N2ition re-enrollment.
  f.setSettings({
    ...changed,
    privateModelRoute: {
      ...settings.privateModelRoute!,
      providerConfigHash: privateProviderConfigHash(
        changed,
        settings.privateModelRoute!.modelSelection,
      ),
    },
  });
};

it.effect("rejects a live same-instance/model configuration change before fetching", () =>
  Effect.gen(function* () {
    const f = yield* fixture({ live: true });
    changeProviderConfiguration(f);
    yield* Effect.gen(function* () {
      const service = yield* N2itionContext.N2itionContext;
      const error = yield* readError(service.read(f.scope(), input));
      expect(error.reason).toBe("route_changed");
      expect(error.message).toContain("Re-enroll");
      expect(f.calls).toHaveLength(0);
    }).pipe(Effect.provide(f.layer));
  }),
);

it.effect("clears live cached context when effective account-route settings change", () =>
  Effect.gen(function* () {
    const f = yield* fixture({ live: true });
    yield* Effect.gen(function* () {
      const service = yield* N2itionContext.N2itionContext;
      yield* service.read(f.scope(), input);
      expect((yield* service.status).taskCount).toBe(1);
      f.setSettings({
        ...f.getSettings(),
        accountRouting: accountRoutingPolicy,
      });
      const status = yield* service.status;
      expect(status.taskCount).toBe(0);
      expect(status.state).toBe("paused");
      expect(status.lastError).toBe("route_changed");
      expect((yield* readError(service.read(f.scope(), input))).reason).toBe("route_changed");
      expect(f.calls).toHaveLength(1);
    }).pipe(Effect.provide(f.layer));
  }),
);

it.effect("discards a live response when provider configuration changes during fetch", () =>
  Effect.gen(function* () {
    const f = yield* fixture({ live: true });
    f.setTransport(() =>
      Effect.sync(() => {
        changeProviderConfiguration(f);
        return f.defaultSnapshot;
      }),
    );
    yield* Effect.gen(function* () {
      const service = yield* N2itionContext.N2itionContext;
      expect((yield* readError(service.read(f.scope(), input))).reason).toBe("route_changed");
      expect((yield* service.status).taskCount).toBe(0);
      expect(f.calls).toHaveLength(1);
    }).pipe(Effect.provide(f.layer));
  }),
);

it.effect("rechecks live consent after usage I/O before model-visible release", () =>
  Effect.gen(function* () {
    const f = yield* fixture({ live: true });
    let writes = 0;
    f.setAfterUsageWrite(() => {
      if (++writes === 2) changeProviderConfiguration(f);
    });
    yield* Effect.gen(function* () {
      const service = yield* N2itionContext.N2itionContext;
      expect((yield* readError(service.read(f.scope(), input))).reason).toBe("route_changed");
      expect((yield* service.status).taskCount).toBe(0);
      expect(f.calls).toHaveLength(1);
    }).pipe(Effect.provide(f.layer));
  }),
);

it.effect("pauses legacy live grants pending explicit route re-enrollment", () =>
  Effect.gen(function* () {
    const f = yield* fixture({ live: true, legacy: true });
    yield* Effect.gen(function* () {
      const service = yield* N2itionContext.N2itionContext;
      const status = yield* service.status;
      expect(status.state).toBe("paused");
      expect(status.lastError).toBe("route_changed");
      const error = yield* readError(service.read(f.scope(), input));
      expect(error.reason).toBe("route_changed");
      expect(error.message).toContain("Re-enroll");
      expect(f.calls).toHaveLength(0);
    }).pipe(Effect.provide(f.layer));
  }),
);

it.effect("releases context for an unchanged explicitly approved live route", () =>
  Effect.gen(function* () {
    const f = yield* fixture({ live: true });
    yield* Effect.gen(function* () {
      const service = yield* N2itionContext.N2itionContext;
      for (let i = 0; i < 2; i++) {
        const result = yield* service.read(f.scope(), input);
        expect(result.tasks.map(({ id }) => id)).toEqual(["synthetic-task"]);
        expect((yield* service.status).state).toBe("connected");
      }
      expect(f.calls).toHaveLength(2);
      expect(f.calls[1]?.digest).toBe(digest);
    }).pipe(Effect.provide(f.layer));
  }),
);

it.effect("rejects changed effective account credentials behind unchanged routing settings", () =>
  Effect.gen(function* () {
    const f = yield* fixture({ live: true });
    const settings = f.getSettings();
    f.setEffectiveSettings({
      ...settings,
      providerInstances: {
        ...settings.providerInstances,
        [providerInstanceId]: {
          ...settings.providerInstances[providerInstanceId]!,
          environment: [
            { name: "INFERENCE_ACCOUNT", value: "synthetic-rotated-account", sensitive: true },
          ],
        },
      },
    });
    yield* Effect.gen(function* () {
      const service = yield* N2itionContext.N2itionContext;
      expect((yield* readError(service.read(f.scope(), input))).reason).toBe("route_changed");
      expect(f.calls).toHaveLength(0);
    }).pipe(Effect.provide(f.layer));
  }),
);

it.effect("rechecks live consent after token I/O immediately before transport", () =>
  Effect.gen(function* () {
    const f = yield* fixture({ live: true });
    f.setBeforeTokenRead(() => changeProviderConfiguration(f));
    yield* Effect.gen(function* () {
      const service = yield* N2itionContext.N2itionContext;
      expect((yield* readError(service.read(f.scope(), input))).reason).toBe("route_changed");
      expect(f.calls).toHaveLength(0);
    }).pipe(Effect.provide(f.layer));
  }),
);

it.effect.each(
  (["pause", "revoke"] as const).flatMap((action) =>
    (["transport", "release"] as const).flatMap((boundary) =>
      ([1, 2] as const).map((pass) => ({ action, boundary, pass })),
    ),
  ),
)(
  "rejects a completed $action while $boundary authorization pass $pass holds an old grant",
  ({ action, boundary, pass }) =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const resume = yield* Deferred.make<void>();
      const f = yield* fixture({ live: true });
      let checks = 0;
      const hook = Effect.gen(function* () {
        if (++checks !== pass) return;
        f.setThreadReadHook(Effect.void);
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(resume);
      });
      if (boundary === "transport") f.setBeforeTokenRead(() => f.setThreadReadHook(hook));
      else {
        let writes = 0;
        f.setAfterUsageWrite(() => {
          if (++writes === 2) f.setThreadReadHook(hook);
        });
      }
      yield* Effect.gen(function* () {
        const service = yield* N2itionContext.N2itionContext;
        const running = yield* Effect.forkChild(service.read(f.scope(), input));
        yield* Deferred.await(entered);
        yield* service.control({ action, expectedEpoch: f.getGrant().epoch });
        yield* Deferred.succeed(resume, undefined);
        const rejected = yield* readError(Fiber.join(running));
        expect([action === "pause" ? "paused" : "revoked", "unauthorized", "changed"]).toContain(
          rejected.reason,
        );
        expect(f.calls).toHaveLength(boundary === "transport" ? 0 : 1);
        expect((yield* service.status).taskCount).toBe(0);
      }).pipe(Effect.provide(f.layer));
    }),
);

it.effect.each(["file", "thread", "settings"] as const)(
  "rejects a %s route change completed while final authorization is suspended",
  (route) =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const resume = yield* Deferred.make<void>();
      const f = yield* fixture({ live: true });
      const hook = Effect.gen(function* () {
        f.setSettingsReadHook(Effect.void);
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(resume);
      });
      let writes = 0;
      f.setAfterUsageWrite(() => {
        if (++writes === 2) f.setSettingsReadHook(hook);
      });
      yield* Effect.gen(function* () {
        const service = yield* N2itionContext.N2itionContext;
        const running = yield* Effect.forkChild(service.read(f.scope(), input));
        yield* Deferred.await(entered);
        if (route === "file") f.changeRouteFile();
        else if (route === "thread") f.changeThreadRoute();
        else changeProviderConfiguration(f);
        yield* Deferred.succeed(resume, undefined);
        expect((yield* readError(Fiber.join(running))).reason).toBe("route_changed");
        expect((yield* service.status).taskCount).toBe(0);
      }).pipe(Effect.provide(f.layer));
    }),
);

it.effect.each(
  [
    { label: "replacement", replacement: new Uint8Array(32).fill(8) },
    { label: "removal", replacement: null },
  ].flatMap(({ label, replacement }) =>
    (["before", "lookup", "fetch", "telemetry"] as const).map((boundary) => ({
      label,
      replacement,
      boundary,
    })),
  ),
)("pauses source credential $label at $boundary", ({ replacement, boundary }) =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const resume = yield* Deferred.make<void>();
    const f = yield* fixture({ live: true });
    const hook = Effect.gen(function* () {
      f.setTokenReadHook(Effect.void);
      f.setUsageWriteHook(Effect.void);
      yield* Deferred.succeed(entered, undefined);
      yield* Deferred.await(resume);
    });
    if (boundary === "before") f.setToken(replacement);
    else if (boundary === "lookup") f.setTokenReadHook(hook);
    else if (boundary === "fetch") f.setTransport(() => hook.pipe(Effect.as(f.defaultSnapshot)));
    else {
      let writes = 0;
      f.setAfterUsageWrite(() => {
        if (++writes === 2) f.setUsageWriteHook(hook);
      });
    }
    yield* Effect.gen(function* () {
      const service = yield* N2itionContext.N2itionContext;
      // Warm the digest cache under the enrolled credential before rotating it.
      if (boundary === "before") {
        f.setToken(token);
        yield* service.read(f.scope(), input);
        f.calls.length = 0;
        f.setToken(replacement);
      }
      const running = yield* Effect.forkChild(service.read(f.scope(), input));
      if (boundary !== "before") {
        yield* Deferred.await(entered);
        f.setToken(replacement);
        yield* Deferred.succeed(resume, undefined);
      }
      expect((yield* readError(Fiber.join(running))).reason).toBe("route_changed");
      expect(f.calls).toHaveLength(boundary === "before" || boundary === "lookup" ? 0 : 1);
      const status = yield* service.status;
      expect(status.taskCount).toBe(0);
      expect(status.state).toBe("paused");
      expect(JSON.stringify(status)).not.toContain(f.getGrant().sourceCredentialHash!);
    }).pipe(Effect.provide(f.layer));
  }),
);

it.effect("drops the old account digest after explicit source re-enrollment", () =>
  Effect.gen(function* () {
    const f = yield* fixture({ live: true });
    yield* Effect.gen(function* () {
      const service = yield* N2itionContext.N2itionContext;
      yield* service.read(f.scope(), input);
      const replacement = new Uint8Array(32).fill(8);
      f.setToken(replacement);
      const next = { ...f.getGrant(), epoch: f.getGrant().epoch + 1 };
      f.setGrant({ ...next, sourceCredentialHash: n2itionSourceCredentialHash(replacement, next) });
      yield* service.read(f.scope({ n2itionGrantEpoch: next.epoch }), input);
      expect(f.calls).toHaveLength(2);
      expect(f.calls[1]?.digest).toBeUndefined();
      expect(f.calls[1]?.token).toBe(new TextDecoder().decode(replacement));
    }).pipe(Effect.provide(f.layer));
  }),
);

it.effect("fails closed when a legacy grant-store stub lacks the atomic consent boundary", () =>
  Effect.gen(function* () {
    const f = yield* fixture({ live: true, missingBoundary: true });
    yield* Effect.gen(function* () {
      const service = yield* N2itionContext.N2itionContext;
      expect((yield* readError(service.read(f.scope(), input))).reason).toBe("route_changed");
      expect(f.calls).toHaveLength(0);
      expect((yield* service.status).state).toBe("paused");
    }).pipe(Effect.provide(f.layer));
  }),
);
