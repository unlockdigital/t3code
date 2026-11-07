import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { SecretProviderId, ServerConfigStreamEvent, UsageLimitSourceId } from "@t3tools/contracts";
import { defineSecretProviderDriver } from "@t3tools/secret-provider-core/server/driver";
import { definition } from "@t3tools/secret-provider-onepassword/shared/definition";
import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as UsageLimitSources from "./UsageLimitSources.ts";

const encodeConfigEvent = Schema.encodeSync(ServerConfigStreamEvent);

it.effect("keeps malformed source URLs encodable for config subscribers", () =>
  Effect.gen(function* () {
    const sources = yield* UsageLimitSources.make;
    yield* sources.refresh;
    const snapshots = yield* sources.current;
    expect(snapshots.map((source) => source.label)).toEqual([
      "local-hub",
      "opaque-hub",
      "Named hub",
      "hub.test:8317",
      "Usage limit source",
    ]);
    expect(() =>
      encodeConfigEvent({
        version: 1,
        type: "usageLimitSourcesUpdated",
        payload: { sources: snapshots },
      }),
    ).not.toThrow();
    expect(snapshots.every((source) => source.error === "No management key configured.")).toBe(
      true,
    );
  }).pipe(
    Effect.provide([
      Layer.succeed(SecretResolver.SecretResolver, {
        read: (references) => Effect.succeed(references.map(() => undefined)),
        invalidate: () => Effect.void,
      }),
      ServerSettings.layerTest({
        usageLimitSources: {
          [UsageLimitSourceId.make("local-hub")]: {
            kind: "cliproxy",
            url: "localhost:8317",
            managementKey: "",
            enabled: true,
          },
          [UsageLimitSourceId.make("opaque-hub")]: {
            kind: "cliproxy",
            url: "file:///tmp/hub",
            managementKey: "",
            enabled: true,
          },
          [UsageLimitSourceId.make("named-hub")]: {
            kind: "cliproxy",
            url: "localhost:8317",
            label: "Named hub",
            managementKey: "",
            enabled: true,
          },
          [UsageLimitSourceId.make("valid-hub")]: {
            kind: "cliproxy",
            url: "https://hub.test:8317",
            managementKey: "",
            enabled: true,
          },
          [UsageLimitSourceId.make(" ")]: {
            kind: "cliproxy",
            url: "localhost:8317",
            managementKey: "",
            enabled: true,
          },
        },
      }),
      Layer.mock(BackgroundPolicy.BackgroundPolicy)({
        shouldRunScopeWork: () => Effect.succeed(false),
      }),
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make(() => Effect.die("Unexpected network request")),
      ),
      NodeCrypto.layer,
    ]),
    Effect.scoped,
  ),
);

it.effect("reads a management key from its secret provider", () => {
  const authorizations: Array<string | undefined> = [];
  const keySource = (reference: string) => ({
    provider: SecretProviderId.make("homelab"),
    reference,
  });
  return Effect.gen(function* () {
    const sources = yield* UsageLimitSources.make;
    yield* sources.refresh;
    const snapshots = yield* sources.current;
    expect(snapshots.map(({ id, error }) => ({ id, error }))).toEqual([
      { id: "resolved-hub", error: undefined },
      {
        id: "unresolved-hub",
        error: "Could not read the management key from its secret provider.",
      },
    ]);
    expect(authorizations).toEqual(["Bearer resolved-key"]);
  }).pipe(
    Effect.provide([
      ServerSettings.layerTest({
        usageLimitSources: {
          [UsageLimitSourceId.make("resolved-hub")]: {
            kind: "cliproxy",
            url: "https://resolved.test",
            managementKey: keySource("cliproxy#key"),
            enabled: true,
          },
          [UsageLimitSourceId.make("unresolved-hub")]: {
            kind: "cliproxy",
            url: "https://unresolved.test",
            managementKey: keySource("missing#key"),
            enabled: true,
          },
        },
      }),
      Layer.mock(BackgroundPolicy.BackgroundPolicy)({
        shouldRunScopeWork: () => Effect.succeed(false),
      }),
      Layer.succeed(SecretResolver.SecretResolver, {
        read: (references) =>
          Effect.succeed(
            references.map((reference) =>
              reference.reference === "cliproxy#key" ? "resolved-key" : undefined,
            ),
          ),
        invalidate: () => Effect.void,
      }),
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.sync(() => {
            authorizations.push(request.headers.authorization);
            return HttpClientResponse.fromWeb(request, Response.json({ files: [] }));
          }),
        ),
      ),
      NodeCrypto.layer,
    ]),
    Effect.scoped,
  );
});

it.effect(
  "keeps the hub destination paired with its secret provider account during refresh",
  () => {
    const providerId = SecretProviderId.make("homelab");
    const sourceId = UsageLimitSourceId.make("hub");
    const provider = (account: string) => ({
      kind: definition.kind,
      label: account,
      config: { account },
    });
    const source = (account: string) => ({
      kind: "cliproxy" as const,
      url: `https://${account}.test`,
      managementKey: { provider: providerId, reference: "op://vault/hub/key" },
      enabled: true,
    });
    const driver = defineSecretProviderDriver({
      kind: definition.kind,
      definition,
      read: ({ account }, references) => Effect.succeed(references.map(() => `${account}-key`)),
    });
    const requests: Array<readonly [string, string | undefined]> = [];

    return Effect.gen(function* () {
      const settings = yield* ServerSettings.ServerSettingsService;
      const testFiber = yield* Effect.fiberId;
      let changeAfterCapture = false;
      const sources = yield* UsageLimitSources.make.pipe(
        Effect.provideService(ServerSettings.ServerSettingsService, {
          ...settings,
          getSettings: settings.getSettings.pipe(
            Effect.tap(() =>
              Effect.gen(function* () {
                if (!changeAfterCapture || (yield* Effect.fiberId) !== testFiber) return;
                changeAfterCapture = false;
                yield* settings.updateSettings({
                  usageLimitSources: { [sourceId]: source("new") },
                  secretProviders: { [providerId]: provider("new") },
                });
              }),
            ),
          ),
        }),
        Effect.provide(
          SecretResolver.layer({
            drivers: [driver],
            secretProviders: settings.getSettings.pipe(
              Effect.map((snapshot) => snapshot.secretProviders),
              Effect.orElseSucceed(() => ({})),
            ),
          }),
        ),
      );
      changeAfterCapture = true;
      yield* sources.refresh;
      yield* sources.refresh;
      expect(new Set(requests.map(([host, authorization]) => `${host}: ${authorization}`))).toEqual(
        new Set(["old.test: Bearer old-key", "new.test: Bearer new-key"]),
      );
    }).pipe(
      Effect.provide([
        ServerSettings.layerTest({
          usageLimitSources: { [sourceId]: source("old") },
          secretProviders: { [providerId]: provider("old") },
        }),
        Layer.mock(BackgroundPolicy.BackgroundPolicy)({
          shouldRunScopeWork: () => Effect.succeed(false),
        }),
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.sync(() => {
              requests.push([new URL(request.url).host, request.headers.authorization]);
              return HttpClientResponse.fromWeb(request, Response.json({ files: [] }));
            }),
          ),
        ),
        NodeServices.layer,
      ]),
      Effect.scoped,
    );
  },
);
