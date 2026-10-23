import {
  ProviderBillingError,
  type ProviderConnectTinfoilBillingInput,
  type ProviderConfigureClaudeBillingInput,
} from "@t3tools/contracts";
import {
  OpenCodeSettings,
  resolveOpenCodeUsageProvider,
} from "@t3tools/provider-opencode/settings";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProviderRegistry from "./ProviderRegistry.ts";
import {
  claudePlatformCreditsToLimits,
  ClaudeConsoleBillingReader,
  encodeClaudeConsoleBillingConnection,
} from "./claudePlatformBilling.ts";

const decodeSettings = Schema.decodeUnknownOption(OpenCodeSettings);
export class ProviderBilling extends Context.Service<
  ProviderBilling,
  {
    readonly connectTinfoil: (
      input: ProviderConnectTinfoilBillingInput,
    ) => Effect.Effect<{ configured: boolean }, ProviderBillingError>;
    readonly configureClaude: (
      input: ProviderConfigureClaudeBillingInput,
    ) => Effect.Effect<{ configured: boolean }, ProviderBillingError>;
  }
>()("t3/provider/ProviderBilling") {}

const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const secrets = yield* SecretRequests.SecretRequests;
  const billingBrowser = yield* Effect.serviceOption(ClaudeConsoleBillingReader);
  const registry = yield* Effect.serviceOption(ProviderRegistry.ProviderRegistry);
  const connectTinfoil = Effect.fn("ProviderBilling.connectTinfoil")(function* (
    input: ProviderConnectTinfoilBillingInput,
  ) {
    const current = yield* settings.getSettings.pipe(
      Effect.mapError(() => new ProviderBillingError({ reason: "saveFailed" })),
    );
    const instance = current.providerInstances[input.instanceId];
    if (!instance) return yield* new ProviderBillingError({ reason: "connectionMissing" });
    const config = decodeSettings(instance.config);
    if (
      instance.driver !== "opencode" ||
      Option.isNone(config) ||
      resolveOpenCodeUsageProvider(config.value) !== "tinfoil"
    ) {
      return yield* new ProviderBillingError({ reason: "unsupportedConnection" });
    }
    const key = (yield* secrets
      .consume({ ref: input.secretRef, projectId: input.projectId })
      .pipe(
        Effect.mapError(() => new ProviderBillingError({ reason: "secretUnavailable" })),
      )).trim();
    if (!key.startsWith("admin_") || key.length > 1024 || /\s/.test(key))
      return yield* new ProviderBillingError({ reason: "invalidKey" });
    yield* settings
      .updateProviderInstance({
        operation: "upsert",
        instanceId: input.instanceId,
        instance: {
          ...instance,
          config: { ...(instance.config as Record<string, unknown>), tinfoilAdminKey: key },
        },
      })
      .pipe(Effect.mapError(() => new ProviderBillingError({ reason: "saveFailed" })));
    return { configured: true };
  });
  const configureClaude = Effect.fn("ProviderBilling.configureClaude")(function* (
    input: ProviderConfigureClaudeBillingInput,
  ) {
    const current = yield* settings.getSettings.pipe(
      Effect.mapError(() => new ProviderBillingError({ reason: "saveFailed" })),
    );
    const instance = current.providerInstances[input.instanceId];
    if (!instance) return yield* new ProviderBillingError({ reason: "connectionMissing" });
    if (instance.driver !== "claudeAgent")
      return yield* new ProviderBillingError({ reason: "unsupportedConnection" });
    if (input.connection !== null) {
      if (Option.isNone(billingBrowser) || Option.isNone(registry))
        return yield* new ProviderBillingError({ reason: "billingUnavailable" });
      const provider = (yield* registry.value.getProviders).find(
        (entry) => entry.instanceId === input.instanceId,
      );
      if (provider?.auth.type !== "apiKey" || provider.auth.status !== "authenticated")
        return yield* new ProviderBillingError({ reason: "unsupportedConnection" });
      const credits = yield* billingBrowser.value
        .read(input.connection)
        .pipe(Effect.mapError(() => new ProviderBillingError({ reason: "billingUnavailable" })));
      const checked = claudePlatformCreditsToLimits({ checkedAt: provider.checkedAt, credits });
      if (!checked.prepaidBalance)
        return yield* new ProviderBillingError({ reason: "billingUnavailable" });
    }
    const raw =
      instance.config !== null && typeof instance.config === "object"
        ? (instance.config as Record<string, unknown>)
        : {};
    const config = {
      ...raw,
      consoleBilling:
        input.connection === null ? "" : encodeClaudeConsoleBillingConnection(input.connection),
    };
    yield* settings
      .updateProviderInstance({
        operation: "upsert",
        instanceId: input.instanceId,
        instance: { ...instance, config },
      })
      .pipe(Effect.mapError(() => new ProviderBillingError({ reason: "saveFailed" })));
    return { configured: input.connection !== null };
  });
  return ProviderBilling.of({ connectTinfoil, configureClaude });
});
export const layer = Layer.effect(ProviderBilling, make);
