import { assert, it } from "@effect/vitest";
import { AccountRoutingPolicy, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as Settings from "./serverSettings.ts";

const policy = Schema.decodeSync(AccountRoutingPolicy)({
  schemaVersion: 1,
  policyId: "codex-default",
  revision: 1,
  mode: "observe",
  modelMatch: "exact",
  stages: [
    { id: "lab-included", instanceId: "lab", fundingIntent: "includedOnly" },
    { id: "personal-included", instanceId: "codex", fundingIntent: "includedOnly" },
    { id: "lab-credits", instanceId: "lab", fundingIntent: "creditsAllowed" },
    { id: "personal-credits", instanceId: "codex", fundingIntent: "creditsAllowed" },
  ],
  maxEvidenceAgeSeconds: 300,
  minimumHeadroomPercent: 5,
  paidApiFallback: false,
});

const layer = Settings.layerTest({
  providerInstances: {
    [ProviderInstanceId.make("codex")]: { driver: ProviderDriverKind.make("codex"), config: {} },
    [ProviderInstanceId.make("lab")]: { driver: ProviderDriverKind.make("codex"), config: {} },
  },
});

it.effect("preserves policy through older-client updates and replaces ordered stages whole", () =>
  Effect.gen(function* () {
    const settings = yield* Settings.ServerSettingsService;
    assert.equal((yield* settings.getSettings).accountRouting, null);
    yield* settings.updateSettings({ accountRouting: policy, accountRoutingExpectedRevision: 0 });
    yield* settings.updateSettings({ branchNamePrefix: "project" });
    assert.deepEqual((yield* settings.getSettings).accountRouting, policy);
    const revised = { ...policy, revision: 2, stages: policy.stages.slice(0, 2) };
    yield* settings.updateSettings({ accountRouting: revised, accountRoutingExpectedRevision: 1 });
    assert.deepEqual((yield* settings.getSettings).accountRouting, revised);
    assert.isFalse(Object.hasOwn(yield* settings.getSettings, "accountRoutingExpectedRevision"));
    yield* settings.updateSettings({ accountRouting: null, accountRoutingExpectedRevision: 2 });
    assert.equal((yield* settings.getSettings).accountRouting, null);
  }).pipe(Effect.provide(layer)),
);

it.effect("serializes conflicting policy writes and preserves the winning revision", () =>
  Effect.gen(function* () {
    const settings = yield* Settings.ServerSettingsService;
    const results = yield* Effect.all(
      ["first", "second"].map((policyId) =>
        settings
          .updateSettings({
            accountRouting: { ...policy, policyId },
            accountRoutingExpectedRevision: 0,
          })
          .pipe(Effect.exit),
      ),
      { concurrency: "unbounded" },
    );
    assert.equal(results.filter(Exit.isSuccess).length, 1);
    assert.equal(results.filter(Exit.isFailure).length, 1);
    assert.equal((yield* settings.getSettings).accountRouting?.revision, 1);
    const rejected = yield* Effect.flip(
      settings.updateSettings({ accountRouting: { ...policy, revision: 2 } }),
    );
    assert.equal(rejected.operation, "account-routing-revision");
  }).pipe(Effect.provide(layer)),
);

it.effect("rejects unknown account references and changed meaning for a stable stage ID", () =>
  Effect.gen(function* () {
    const settings = yield* Settings.ServerSettingsService;
    const unknown = yield* Effect.flip(
      settings.updateSettings({
        accountRouting: {
          ...policy,
          stages: [{ ...policy.stages[0]!, instanceId: ProviderInstanceId.make("missing") }],
        },
        accountRoutingExpectedRevision: 0,
      }),
    );
    assert.equal(unknown.operation, "account-routing-reference");
    yield* settings.updateSettings({ accountRouting: policy, accountRoutingExpectedRevision: 0 });
    const changed = yield* Effect.flip(
      settings.updateSettings({
        accountRouting: {
          ...policy,
          revision: 2,
          stages: [{ ...policy.stages[0]!, instanceId: ProviderInstanceId.make("codex") }],
        },
        accountRoutingExpectedRevision: 1,
      }),
    );
    assert.equal(changed.operation, "account-routing-stage");
    assert.deepEqual((yield* settings.getSettings).accountRouting, policy);
  }).pipe(Effect.provide(layer)),
);

it.effect("accepts an implicit default account without materializing its configuration", () =>
  Effect.gen(function* () {
    const settings = yield* Settings.ServerSettingsService;
    const implicitPolicy = { ...policy, stages: [policy.stages[1]!] };
    yield* settings.updateSettings({
      accountRouting: implicitPolicy,
      accountRoutingExpectedRevision: 0,
    });
    const saved = yield* settings.getSettings;
    assert.deepEqual(saved.accountRouting, implicitPolicy);
    assert.deepEqual(saved.providerInstances, {});
  }).pipe(Effect.provide(Settings.layerTest())),
);

it.effect("creates an account and references it in the same atomic policy update", () =>
  Effect.gen(function* () {
    const settings = yield* Settings.ServerSettingsService;
    const createdPolicy = { ...policy, stages: [policy.stages[0]!] };
    const instanceId = ProviderInstanceId.make("lab");
    yield* settings.updateProviderInstance(
      {
        operation: "create",
        instanceId,
        instance: { driver: ProviderDriverKind.make("codex") },
      },
      { accountRouting: createdPolicy, accountRoutingExpectedRevision: 0 },
    );
    const saved = yield* settings.getSettings;
    assert.deepEqual(saved.accountRouting, createdPolicy);
    assert.equal(saved.providerInstances[instanceId]?.driver, "codex");
    yield* settings.updateProviderInstance({ operation: "remove", instanceId });
    assert.deepEqual((yield* settings.getSettings).accountRouting, createdPolicy);
    assert.isUndefined((yield* settings.getSettings).providerInstances[instanceId]);
  }).pipe(Effect.provide(Settings.layerTest())),
);

it.effect("rejects a policy referencing an account deleted by the same request", () =>
  Effect.gen(function* () {
    const settings = yield* Settings.ServerSettingsService;
    const rejected = yield* Effect.flip(
      settings.updateProviderInstance(
        { operation: "remove", instanceId: ProviderInstanceId.make("lab") },
        { accountRouting: policy, accountRoutingExpectedRevision: 0 },
      ),
    );
    assert.equal(rejected.operation, "account-routing-reference");
    assert.equal((yield* settings.getSettings).accountRouting, null);
    assert.isDefined(
      (yield* settings.getSettings).providerInstances[ProviderInstanceId.make("lab")],
    );
  }).pipe(Effect.provide(layer)),
);
