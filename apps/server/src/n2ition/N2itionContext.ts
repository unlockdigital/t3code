// @effect-diagnostics globalDate:off -- All dates derive from the injected Effect Clock for calendar projection and status serialization.
import {
  decodeN2itionSnapshot,
  type N2itionSnapshot,
  type ServerSettings,
} from "@t3tools/contracts";
import {
  N2itionConnectionError,
  N2itionGrant,
  N2itionStatus,
  type N2itionControlInput,
} from "@t3tools/contracts/n2itionConnection";
import * as DateTime from "effect/DateTime";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as ServerConfig from "../config.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ThreadCommandExecutor from "../orchestration-v2/ThreadCommandExecutor.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import type { McpInvocationScope } from "../mcp/McpInvocationContext.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as GrantStore from "./N2itionGrantStore.ts";
import * as Transport from "./N2itionTransport.ts";
import * as Settings from "../serverSettings.ts";
import {
  assertPrivateModelSelection,
  isPrivateInferenceSelection,
} from "../privacy/modelRoutingPolicy.ts";
import { n2itionRouteBinding, n2itionSourceCredentialHash } from "./routeConsent.ts";
import {
  selectN2itionContext,
  type N2itionContextInput,
  type N2itionContextResult,
} from "./context.ts";

const isConnectionError = Schema.is(N2itionConnectionError);
const jsonCodec = Schema.fromJsonString(Schema.Unknown);
const decodeJson = Schema.decodeUnknownEffect(jsonCodec);
const encodeJson = Schema.encodeEffect(jsonCodec);
type Usage = { -readonly [K in keyof N2itionStatus["usage"]]: N2itionStatus["usage"][K] };
const iso = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));
const emptyUsage = (): Usage => ({
  reads: 0,
  refreshes: 0,
  failures: 0,
  notesReads: 0,
  returnedTasks: 0,
  backgroundModelCalls: 0,
});
export class N2itionContext extends Context.Service<
  N2itionContext,
  {
    readonly status: Effect.Effect<N2itionStatus, N2itionConnectionError>;
    readonly read: (
      scope: McpInvocationScope,
      input: N2itionContextInput,
    ) => Effect.Effect<N2itionContextResult, N2itionConnectionError>;
    readonly callerStatus: (
      scope: McpInvocationScope,
    ) => Effect.Effect<N2itionStatus, N2itionConnectionError>;
    readonly control: (
      input: N2itionControlInput,
    ) => Effect.Effect<N2itionStatus, N2itionConnectionError>;
    readonly refresh: Effect.Effect<N2itionStatus, N2itionConnectionError>;
    readonly sweep: Effect.Effect<void>;
  }
>()("t3/n2ition/N2itionContext") {}

export const make = Effect.gen(function* () {
  const grants = yield* GrantStore.N2itionGrantStore;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const transport = yield* Transport.N2itionTransport;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const threadDispatch = yield* ThreadCommandExecutor.ThreadCommandExecutor;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const settingsService = yield* Settings.ServerSettingsService;
  const crypto = yield* Crypto.Crypto;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const lock = yield* Semaphore.make(1);
  let cache: N2itionSnapshot | null = null;
  let cacheGrant = "";
  let lastCheckedAt: string | null = null;
  let lastError: N2itionConnectionError["reason"] | null = null;
  let nextCheckAt = 0;
  let budgetMinute = -1,
    minuteReads = 0;
  let lastRun = "",
    runReads = 0;
  const usagePath = path.join(config.stateDir, "n2ition-usage.json");
  let days: Record<string, Usage> = {};
  const usageCodec = Schema.fromJsonString(
    Schema.Record(Schema.String, N2itionStatus.fields.usage),
  );
  const grantCodec = Schema.fromJsonString(N2itionGrant);
  const encodeGrant = (grant: N2itionGrant) =>
    Schema.encodeEffect(grantCodec)(grant).pipe(
      Effect.mapError(() => new N2itionConnectionError({ reason: "invalid_data" })),
    );
  const readUsage = Effect.gen(function* () {
    if (!(yield* fs.exists(usagePath))) return;
    if (Number((yield* fs.stat(usagePath)).size) > 32768) return;
    const text = yield* fs.readFileString(usagePath);
    const value = yield* Schema.decodeUnknownEffect(usageCodec)(text, {
      onExcessProperty: "error",
    });
    days = Object.fromEntries(
      Object.entries(value).filter(
        ([day, row]) =>
          /^\d{4}-\d{2}-\d{2}$/.test(day) &&
          Object.values(row).every((n) => Number.isSafeInteger(n) && n >= 0),
      ),
    );
  }).pipe(Effect.catch(() => Effect.void));
  yield* readUsage;
  const record = Effect.fn("N2itionContext.recordUsage")(function* (change: Partial<Usage>) {
    const now = yield* Clock.currentTimeMillis;
    const day = iso(now).slice(0, 10);
    const counts = days[day] ?? emptyUsage();
    days[day] = { ...counts };
    for (const key of Object.keys(change) as (keyof Usage)[])
      if (key !== "backgroundModelCalls") days[day]![key] += change[key] ?? 0;
    const cutoff = iso(now - 29 * 86400000).slice(0, 10);
    days = Object.fromEntries(Object.entries(days).filter(([key]) => key >= cutoff && key <= day));
    yield* Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* fs.makeTempDirectoryScoped({
          directory: config.stateDir,
          prefix: "n2ition-usage-",
        });
        const tmp = path.join(dir, "usage.json");
        const contents = yield* Schema.encodeEffect(usageCodec)(days);
        yield* fs.writeFileString(tmp, contents, { mode: 0o600 });
        yield* fs.rename(tmp, usagePath);
      }),
    ).pipe(Effect.mapError(() => new N2itionConnectionError({ reason: "unavailable" })));
  });
  const readCredential = Effect.fn("N2itionContext.readCredential")(function* (
    grant: N2itionGrant,
  ) {
    const bytes = yield* secrets.get("n2ition-read-token").pipe(
      Effect.mapError(
        () =>
          new N2itionConnectionError({
            reason: grant.source === "live" ? "route_changed" : "unavailable",
          }),
      ),
    );
    if (
      Option.isNone(bytes) ||
      bytes.value.length < 32 ||
      bytes.value.length > 512 ||
      (grant.source === "live" &&
        n2itionSourceCredentialHash(bytes.value, grant) !== grant.sourceCredentialHash)
    )
      return yield* new N2itionConnectionError({
        reason: grant.source === "live" ? "route_changed" : "unavailable",
      });
    return bytes.value;
  });
  const authorize = Effect.fn("N2itionContext.authorize")(function* (
    scope?: McpInvocationScope,
    effectiveSnapshot?: ServerSettings,
  ) {
    const grant = yield* grants.read;
    if (!grant) return yield* new N2itionConnectionError({ reason: "disabled" });
    if (grant.environmentId !== (yield* environment.getEnvironmentId))
      return yield* new N2itionConnectionError({ reason: "unauthorized" });
    const now = yield* Clock.currentTimeMillis;
    yield* Effect.try({
      try: () => GrantStore.validateGrant(grant, now),
      catch: (e) =>
        isConnectionError(e) ? e : new N2itionConnectionError({ reason: "invalid_data" }),
    });
    if (
      scope &&
      (!scope.thread ||
        !scope.capabilities.has("n2ition-read") ||
        scope.environmentId !== grant.environmentId ||
        scope.thread.threadId !== grant.threadId ||
        scope.thread.providerInstanceId !== grant.providerInstanceId ||
        scope.n2itionGrantEpoch !== grant.epoch)
    )
      return yield* new N2itionConnectionError({ reason: "unauthorized" });
    yield* grants.checkRouteFiles(grant);
    const thread = yield* threads
      .getThreadShell(grant.threadId)
      .pipe(Effect.mapError(() => new N2itionConnectionError({ reason: "route_changed" })));
    if (
      !thread ||
      thread.deletedAt !== null ||
      thread.archivedAt !== null ||
      thread.providerInstanceId !== grant.providerInstanceId ||
      thread.modelSelection.instanceId !== grant.providerInstanceId ||
      thread.modelSelection.model !== grant.model
    )
      return yield* new N2itionConnectionError({ reason: "route_changed" });
    if (grant.source === "live") {
      const settings = yield* settingsService.getRoutingSettings.pipe(
        Effect.mapError(() => new N2itionConnectionError({ reason: "route_changed" })),
      );
      // The approved isolated OpenCode/Tinfoil route is the qualified live path.
      if (!isPrivateInferenceSelection(settings, thread.modelSelection))
        return yield* new N2itionConnectionError({ reason: "route_changed" });
      yield* assertPrivateModelSelection(settings, thread, thread.modelSelection).pipe(
        Effect.mapError(() => new N2itionConnectionError({ reason: "route_changed" })),
      );
      const effective =
        effectiveSnapshot ??
        (yield* settingsService.getSettings.pipe(
          Effect.mapError(() => new N2itionConnectionError({ reason: "route_changed" })),
        ));
      const binding = n2itionRouteBinding(effective, thread, grant.routeFiles);
      if (
        binding.providerConfigHash !== grant.routeBinding?.providerConfigHash ||
        binding.accountRouteHash !== grant.routeBinding?.accountRouteHash
      )
        return yield* new N2itionConnectionError({ reason: "route_changed" });
      yield* readCredential(grant);
    }
    return { grant, thread };
  });
  const withAuthorization = Effect.fn("N2itionContext.withAuthorization")(function* <A, E, R>(
    expected: N2itionGrant,
    use: (credential: Uint8Array) => Effect.Effect<A, E, R>,
    scope?: McpInvocationScope,
  ) {
    // Preliminary I/O grants no authority. Recollect under the same locks used
    // by managed thread/settings mutations, then cross the local consent boundary.
    yield* authorize(scope);
    return yield* threadDispatch.withLock(
      expected.threadId,
      settingsService
        .withSettingsSnapshot((effective) =>
          Effect.gen(function* () {
            yield* authorize(scope, effective);
            if (!grants.withConsent)
              return yield* new N2itionConnectionError({ reason: "route_changed" });
            return yield* grants.withConsent(expected, use);
          }),
        )
        .pipe(
          Effect.mapError((error) =>
            isConnectionError(error)
              ? error
              : new N2itionConnectionError({ reason: "route_changed" }),
          ),
        ),
    );
  });
  const invalidate = (reason: N2itionConnectionError["reason"]) => {
    cache = null;
    cacheGrant = "";
    lastError = reason;
  };
  const fetchSnapshot = Effect.fn("N2itionContext.fetchSnapshot")(function* (
    grant: N2itionGrant,
    purpose: "interactive" | "automatic",
  ) {
    const encodedGrant = yield* encodeGrant(grant);
    yield* readCredential(grant);
    const request = yield* withAuthorization(grant, (credential) => {
      if (cacheGrant !== encodedGrant) {
        cache = null;
        cacheGrant = "";
      }
      // The child starts immediately through FetchHttpClient's request initiation.
      // Join outside the locks; completed controls discard any in-flight response.
      return Effect.forkChild(
        transport.snapshot({
          origin: grant.origin,
          token: new TextDecoder().decode(credential),
          purpose,
          ...(cache ? { digest: cache.digest } : {}),
        }),
        { startImmediately: true },
      );
    });
    const text = yield* Fiber.join(request);
    const raw = yield* decodeJson(text).pipe(
      Effect.mapError(() => new N2itionConnectionError({ reason: "invalid_data" })),
    );
    const snapshot = yield* Effect.try({
      try: () => decodeN2itionSnapshot(raw),
      catch: () => new N2itionConnectionError({ reason: "invalid_data" }),
    });
    const taskJson = yield* encodeJson(snapshot.tasks).pipe(
      Effect.mapError(() => new N2itionConnectionError({ reason: "invalid_data" })),
    );
    const digest = yield* crypto.digest("SHA-256", new TextEncoder().encode(taskJson)).pipe(
      Effect.map((b) => Buffer.from(b).toString("hex")),
      Effect.mapError(() => new N2itionConnectionError({ reason: "unavailable" })),
    );
    const now = yield* Clock.currentTimeMillis;
    if (snapshot.source !== grant.source || digest !== snapshot.digest)
      return yield* new N2itionConnectionError({ reason: "invalid_data" });
    const generated = Date.parse(snapshot.generatedAt),
      expires = Date.parse(snapshot.expiresAt);
    if (
      generated > now + 60000 ||
      expires <= now ||
      expires <= generated ||
      expires - generated > 12 * 3600000
    )
      return yield* new N2itionConnectionError({ reason: "expired" });
    yield* withAuthorization(grant, () =>
      Effect.sync(() => {
        cache = snapshot;
        cacheGrant = encodedGrant;
        lastCheckedAt = iso(now);
        lastError = null;
        nextCheckAt = now + grant.cadenceHours * 3600000;
      }),
    );
    yield* record({ refreshes: 1 });
    return snapshot;
  });
  const status = Effect.gen(function* () {
    const grant = yield* grants.read;
    if (grant?.source === "live" && grant.mode === "active")
      yield* withAuthorization(grant, () => Effect.void).pipe(
        Effect.catch((error) => Effect.sync(() => invalidate(error.reason))),
      );
    const now = yield* Clock.currentTimeMillis;
    if (
      cache &&
      (Date.parse(cache.expiresAt) <= now || !grant || cacheGrant !== (yield* encodeGrant(grant)))
    )
      cache = null;
    const cutoff = iso(now - 29 * 86400000).slice(0, 10);
    const usage = emptyUsage();
    for (const [day, row] of Object.entries(days))
      if (day >= cutoff)
        for (const key of Object.keys(usage) as (keyof Usage)[])
          if (key !== "backgroundModelCalls") usage[key] += row[key];
    return new N2itionStatus({
      localMode: grant?.mode ?? null,
      state: !grant
        ? "disabled"
        : grant.mode !== "active"
          ? grant.mode
          : Date.parse(grant.expiresAt) <= now
            ? "expired"
            : lastError === "route_changed"
              ? "paused"
              : (lastError ?? (cache ? "connected" : "awaiting_connection")),
      source: grant?.source ?? null,
      epoch: grant?.epoch ?? null,
      lastCheckedAt,
      lastError,
      nextCheckAt: nextCheckAt ? iso(nextCheckAt) : null,
      cadenceHours: grant?.cadenceHours ?? null,
      expiresAt: grant?.expiresAt ?? null,
      taskCount: cache?.tasks.length ?? 0,
      usage,
    });
  });
  const read = Effect.fn("N2itionContext.read")(function* (
    scope: McpInvocationScope,
    input: N2itionContextInput,
  ) {
    return yield* lock
      .withPermits(1)(
        Effect.gen(function* () {
          const { grant, thread } = yield* authorize(scope);
          const now = yield* Clock.currentTimeMillis;
          const minute = Math.floor(now / 60000);
          if (minute !== budgetMinute) {
            budgetMinute = minute;
            minuteReads = 0;
          }
          const run = thread.activeRunId ?? "idle";
          if (run !== lastRun) {
            lastRun = run;
            runReads = 0;
          }
          if (++minuteReads > 30 || ++runReads > 12)
            return yield* new N2itionConnectionError({ reason: "rate_limited" });
          const snapshot = yield* fetchSnapshot(grant, "interactive");
          if (
            (input.offset > 0 && !input.expectedDigest) ||
            (input.expectedDigest && input.expectedDigest !== snapshot.digest)
          )
            return yield* new N2itionConnectionError({ reason: "changed" });
          yield* authorize(scope);
          const result = yield* Effect.try({
            try: () =>
              selectN2itionContext(
                snapshot,
                input,
                grant.origin,
                DateTime.toDateUtc(DateTime.makeUnsafe(now)),
              ),
            catch: () => new N2itionConnectionError({ reason: "too_large" }),
          });
          yield* record({
            reads: 1,
            notesReads: Number(input.includeNotes),
            returnedTasks: result.tasks.length,
          });
          // Authorization is checked again after telemetry I/O, before model-visible release.
          return yield* withAuthorization(
            grant,
            () =>
              Effect.sync(() => ({
                ...result,
                checkedAt: lastCheckedAt!,
              })),
            scope,
          );
        }),
      )
      .pipe(
        Effect.tapError((error) => Effect.sync(() => invalidate(error.reason))),
        Effect.tapError(() => record({ failures: 1 })),
      );
  });
  const refresh = lock
    .withPermits(1)(
      Effect.gen(function* () {
        const { grant } = yield* authorize();
        yield* fetchSnapshot(grant, "automatic");
        return yield* status;
      }),
    )
    .pipe(
      Effect.tapError((error) => Effect.sync(() => invalidate(error.reason))),
      Effect.tapError(() => record({ failures: 1 })),
    );
  const sweep = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const grant = yield* grants.read;
    if (!grant || grant.mode !== "active") {
      cache = null;
      return;
    }
    if (now < nextCheckAt) return;
    nextCheckAt = now + grant.cadenceHours * 3600000;
    yield* refresh;
  }).pipe(Effect.catch(() => Effect.void));
  const control = Effect.fn("N2itionContext.control")(function* (input: N2itionControlInput) {
    yield* grants.control(input);
    cache = null;
    cacheGrant = "";
    nextCheckAt = 0;
    lastError = null;
    return yield* status;
  });
  const callerStatus = Effect.fn("N2itionContext.callerStatus")(function* (
    scope: McpInvocationScope,
  ) {
    const grant = yield* grants.read;
    if (
      !grant ||
      !scope.thread ||
      scope.environmentId !== grant.environmentId ||
      grant.environmentId !== (yield* environment.getEnvironmentId) ||
      scope.n2itionGrantEpoch !== grant.epoch ||
      grant.mode !== "active" ||
      scope.thread.threadId !== grant.threadId ||
      scope.thread.providerInstanceId !== grant.providerInstanceId ||
      !scope.capabilities.has("n2ition-read")
    )
      return yield* new N2itionConnectionError({ reason: "unauthorized" });
    return yield* status;
  });
  return N2itionContext.of({ status, read, callerStatus, control, refresh, sweep });
});
export const layer = Layer.effect(
  N2itionContext,
  Effect.gen(function* () {
    const service = yield* make;
    const scheduler = yield* Scheduler.Scheduler;
    yield* scheduler.register("n2ition-context", service.sweep);
    return service;
  }),
).pipe(Layer.provide(ThreadCommandExecutor.layer));
