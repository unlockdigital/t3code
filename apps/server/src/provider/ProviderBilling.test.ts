import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  SecretRef,
  ClaudeConsoleBillingReadError,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProviderBilling from "./ProviderBilling.ts";
import * as Providers from "./ProviderRegistry.ts";
import {
  encodeClaudeConsoleBillingConnection,
  decodeClaudeConsoleBillingConnection,
  ClaudeConsoleBillingReader,
} from "./claudePlatformBilling.ts";

const instanceId = ProviderInstanceId.make("private-account");
const projectId = ProjectId.make("project");
const ref = SecretRef.make("secret-ref:11111111111111111111111111111111");
const input = { instanceId, projectId, secretRef: ref };
const initial = {
  driver: ProviderDriverKind.make("opencode"),
  enabled: true,
  displayName: "Synthetic account",
  config: {
    customModels: ["tinfoil/kimi-k3"],
    customSetting: "preserved",
    serverPassword: "existing-private-password",
  },
  environment: [{ name: "XDG_CONFIG_HOME", value: "/synthetic", sensitive: false }],
};
const fixture = (key: string, driver = initial.driver) =>
  ProviderBilling.layer.pipe(
    Layer.provideMerge(
      ServerSettings.layerTest({ providerInstances: { [instanceId]: { ...initial, driver } } }),
    ),
    Layer.provide(
      Layer.mock(SecretRequests.SecretRequests)({
        consume: (requested) =>
          Effect.sync(() => {
            assert.deepEqual(requested, { ref, projectId });
            return key;
          }),
      }),
    ),
  );

it.effect(
  "connects a private billing key to its selected account without returning or exporting it",
  () =>
    Effect.gen(function* () {
      const service = yield* ProviderBilling.ProviderBilling;
      const settings = yield* ServerSettings.ServerSettingsService;
      const result = yield* service.connectTinfoil(input);
      assert.deepEqual(result, { configured: true });
      const saved = (yield* settings.getSettings).providerInstances[instanceId]!;
      assert.deepEqual(saved.environment, initial.environment);
      assert.deepInclude(saved.config, {
        tinfoilAdminKey: "admin_synthetic_key",
        customSetting: "preserved",
        serverPassword: "existing-private-password",
      });
      assert.notInclude(JSON.stringify(result), "admin_synthetic_key");
      assert.notInclude(
        JSON.stringify(ServerSettings.redactServerSettingsForClient(yield* settings.getSettings)),
        "admin_synthetic_key",
      );
    }).pipe(Effect.provide(fixture("admin_synthetic_key"))),
);

it.effect("rejects an inference key and preserves the existing connection", () =>
  Effect.gen(function* () {
    const service = yield* ProviderBilling.ProviderBilling;
    const error = yield* service.connectTinfoil(input).pipe(Effect.flip);
    assert.equal(error.reason, "invalidKey");
    assert.notInclude(JSON.stringify(error), "tk_synthetic_key");
    const settings = yield* ServerSettings.ServerSettingsService;
    assert.notInclude(
      JSON.stringify((yield* settings.getSettings).providerInstances[instanceId]?.config),
      "tk_synthetic_key",
    );
  }).pipe(Effect.provide(fixture("tk_synthetic_key"))),
);

it.effect("rejects another provider before consuming the private key", () =>
  Effect.gen(function* () {
    const service = yield* ProviderBilling.ProviderBilling;
    const error = yield* service.connectTinfoil(input).pipe(Effect.flip);
    assert.equal(error.reason, "unsupportedConnection");
  }).pipe(
    Effect.provide(
      ProviderBilling.layer.pipe(
        Layer.provide(
          ServerSettings.layerTest({
            providerInstances: {
              [instanceId]: { ...initial, driver: ProviderDriverKind.make("codex") },
            },
          }),
        ),
        Layer.provide(
          Layer.mock(SecretRequests.SecretRequests)({
            consume: () => Effect.die("Must not consume a key for another provider"),
          }),
        ),
      ),
    ),
  ),
);

const connection = { profileId: "default", organizationId: "11111111-1111-4111-8111-111111111111" };
const claudeInitial = {
  ...initial,
  driver: ProviderDriverKind.make("claudeAgent"),
  config: { homePath: "/synthetic/claude", preserved: true, consoleBilling: "" },
};
const claudeFixture = (authType = "apiKey", failed = false) =>
  ProviderBilling.layer.pipe(
    Layer.provideMerge(
      ServerSettings.layerTest({ providerInstances: { [instanceId]: claudeInitial } }),
    ),
    Layer.provide(
      Layer.mock(SecretRequests.SecretRequests)({
        consume: () => Effect.die("Console billing must not consume a credential"),
      }),
    ),
    Layer.provide(
      Layer.succeed(ClaudeConsoleBillingReader, {
        read: (requested) => {
          assert.deepEqual(requested, connection);
          return failed
            ? Effect.fail(new ClaudeConsoleBillingReadError({ reason: "signInRequired" }))
            : Effect.succeed({ currency: "USD", amount: 7310 });
        },
      }),
    ),
    Layer.provide(
      Layer.mock(Providers.ProviderRegistry)({
        getProviders: Effect.succeed([
          {
            instanceId,
            checkedAt: "2025-02-16T12:00:00.000Z",
            auth: { status: "authenticated", type: authType },
          } as ServerProvider,
        ]),
      }),
    ),
  );

it.effect(
  "binds Console billing only to the selected API instance and redacts organization metadata",
  () =>
    Effect.gen(function* () {
      const service = yield* ProviderBilling.ProviderBilling;
      assert.deepEqual(yield* service.configureClaude({ instanceId, connection }), {
        configured: true,
      });
      const settings = yield* ServerSettings.ServerSettingsService;
      const saved = (yield* settings.getSettings).providerInstances[instanceId]!;
      assert.deepEqual(saved.environment, claudeInitial.environment);
      assert.deepInclude(saved.config, {
        preserved: true,
        homePath: "/synthetic/claude",
        consoleBilling: encodeClaudeConsoleBillingConnection(connection),
      });
      assert.notInclude(
        JSON.stringify(ServerSettings.redactServerSettingsForClient(yield* settings.getSettings)),
        connection.organizationId,
      );
    }).pipe(Effect.provide(claudeFixture())),
);

it.effect("rejects subscription accounts and expired Console access without saving a binding", () =>
  Effect.gen(function* () {
    const service = yield* ProviderBilling.ProviderBilling;
    const failure = yield* service.configureClaude({ instanceId, connection }).pipe(Effect.flip);
    assert.equal(failure.reason, "unsupportedConnection");
    const settings = yield* ServerSettings.ServerSettingsService;
    assert.deepEqual(
      (yield* settings.getSettings).providerInstances[instanceId]!.config,
      claudeInitial.config,
    );
  }).pipe(Effect.provide(claudeFixture("enterprise"))),
);

it.effect("keeps the connection unchanged when Console sign-in has expired", () =>
  Effect.gen(function* () {
    const service = yield* ProviderBilling.ProviderBilling;
    const failure = yield* service.configureClaude({ instanceId, connection }).pipe(Effect.flip);
    assert.equal(failure.reason, "billingUnavailable");
    const settings = yield* ServerSettings.ServerSettingsService;
    assert.deepEqual(
      (yield* settings.getSettings).providerInstances[instanceId]!.config,
      claudeInitial.config,
    );
  }).pipe(Effect.provide(claudeFixture("apiKey", true))),
);

it.effect("disconnects billing while preserving inference settings and environment", () =>
  Effect.gen(function* () {
    const service = yield* ProviderBilling.ProviderBilling;
    yield* service.configureClaude({ instanceId, connection });
    assert.deepEqual(yield* service.configureClaude({ instanceId, connection: null }), {
      configured: false,
    });
    const settings = yield* ServerSettings.ServerSettingsService;
    const saved = (yield* settings.getSettings).providerInstances[instanceId]!;
    assert.deepEqual(saved.config, claudeInitial.config);
    assert.deepEqual(saved.environment, claudeInitial.environment);
    assert.isUndefined(decodeClaudeConsoleBillingConnection("invalid-synthetic-binding"));
  }).pipe(Effect.provide(claudeFixture())),
);
