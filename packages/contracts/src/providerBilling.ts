import * as Schema from "effect/Schema";
import { ProjectId, SecretRef, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const ProviderConnectTinfoilBillingInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  projectId: ProjectId,
  secretRef: SecretRef,
});
export type ProviderConnectTinfoilBillingInput = typeof ProviderConnectTinfoilBillingInput.Type;

export const ClaudeConsoleBillingConnection = Schema.Struct({
  profileId: TrimmedNonEmptyString,
  organizationId: TrimmedNonEmptyString.check(
    Schema.isPattern(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i),
  ),
});
export type ClaudeConsoleBillingConnection = typeof ClaudeConsoleBillingConnection.Type;

export const ProviderConfigureClaudeBillingInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  connection: Schema.NullOr(ClaudeConsoleBillingConnection),
});
export type ProviderConfigureClaudeBillingInput = typeof ProviderConfigureClaudeBillingInput.Type;

export class ClaudeConsoleBillingReadError extends Schema.TaggedError<ClaudeConsoleBillingReadError>()(
  "ClaudeConsoleBillingReadError",
  {
    reason: Schema.Literals([
      "invalidBinding",
      "signInRequired",
      "organizationUnavailable",
      "requestFailed",
      "invalidResponse",
    ]),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "invalidBinding":
        return "Reconnect Claude Console billing to a saved browser profile.";
      case "signInRequired":
        return "Sign in to Claude Console with billing access to refresh credits.";
      case "organizationUnavailable":
        return "The connected Claude API organization is unavailable in this browser profile.";
      case "requestFailed":
        return "Claude Console billing could not be refreshed. Try again.";
      case "invalidResponse":
        return "Claude Console returned an unsupported credit balance.";
    }
  }
}

export class ProviderBillingError extends Schema.TaggedError<ProviderBillingError>()(
  "ProviderBillingError",
  {
    reason: Schema.Literals([
      "connectionMissing",
      "unsupportedConnection",
      "invalidKey",
      "secretUnavailable",
      "saveFailed",
      "billingUnavailable",
    ]),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "connectionMissing":
        return "The provider connection no longer exists.";
      case "unsupportedConnection":
        return "Select a supported API connection for this billing source.";
      case "invalidKey":
        return "Tinfoil billing requires an admin key.";
      case "secretUnavailable":
        return "The private key request is unavailable. Enter it again through the private key card.";
      case "saveFailed":
        return "The billing key could not be saved.";
      case "billingUnavailable":
        return "Connect a signed-in Claude Console browser profile with access to this API organization's billing.";
    }
  }
}
