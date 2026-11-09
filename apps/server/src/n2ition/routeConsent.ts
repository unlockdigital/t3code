// @effect-diagnostics nodeBuiltinImport:off -- Server-only consent fingerprints use the connector credential as the HMAC key.
import * as NodeCrypto from "node:crypto";
import type { OrchestrationV2AppThread, ServerSettings } from "@t3tools/contracts";
import type { N2itionGrant, N2itionInferenceIdentity } from "@t3tools/contracts/n2itionConnection";
import { providerConfigurationHash } from "@t3tools/shared/providerConfigurationHash";
import {
  isPrivateInferenceSelection,
  requiredPrivateRoute,
} from "../privacy/modelRoutingPolicy.ts";

// Enrollment and authorization derive these digests from server settings. External
// connector/account files remain explicit owner-qualified evidence, checked separately.
export function n2itionRouteBinding(
  settings: ServerSettings,
  thread: Pick<OrchestrationV2AppThread, "projectId" | "modelSelection" | "privateModelRoute">,
  routeFiles: N2itionGrant["routeFiles"],
): NonNullable<N2itionGrant["routeBinding"]> {
  const required = requiredPrivateRoute(settings, thread);
  const privateRoute =
    required === null && isPrivateInferenceSelection(settings, thread.modelSelection)
      ? settings.privateModelRoute
      : required;
  return {
    // Effective settings include materialized account/environment values. Only their
    // digest enters the grant; redacted markers alone cannot bind an account change.
    providerConfigHash: providerConfigurationHash(
      settings.providerInstances[thread.modelSelection.instanceId] ?? null,
    ),
    accountRouteHash: providerConfigurationHash({
      projectId: thread.projectId,
      modelSelection: thread.modelSelection,
      privateRoute,
      accountRouting: settings.accountRouting,
      routeFiles: [...routeFiles].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    }),
  };
}

// The domain and destination scope prevent reuse across environments. Enrollment
// computes this locally after the owner has qualified the source account.
export function n2itionSourceCredentialHash(
  credential: Uint8Array,
  grant: Pick<N2itionGrant, "environmentId" | "origin">,
): string {
  return NodeCrypto.createHmac("sha256", credential)
    .update(JSON.stringify(["n2ition-source-v1", grant.environmentId, grant.origin]))
    .digest("hex");
}

// Callers may qualify Default only after fresh trusted runtime inspection.
export function n2itionResolvedModel(
  selected: string,
  identity: N2itionInferenceIdentity,
  verifiedDefault = false,
) {
  if (!selected || selected === "auto" || (selected === "default" && !verifiedDefault)) return null;
  const model = identity.upstreamModel;
  if (!model.trim() || model === "default" || model === "auto") return null;
  return selected === "default" ||
    selected === model ||
    selected === `${identity.upstreamProvider}:${model}`
    ? model
    : null;
}

export function n2itionVerifiedRouteBinding(
  settings: ServerSettings,
  thread: Pick<OrchestrationV2AppThread, "projectId" | "modelSelection" | "privateModelRoute">,
  identity: N2itionInferenceIdentity,
  sourcePaths: ReadonlyArray<string>,
) {
  const required = requiredPrivateRoute(settings, thread);
  const options = (thread.modelSelection.options ?? []).filter(
    (option) => option.id !== "reasoningEffort",
  );
  return {
    version: 2 as const,
    identity,
    providerConfigHash: providerConfigurationHash(
      settings.providerInstances[thread.modelSelection.instanceId] ?? null,
    ),
    accountRouteHash: providerConfigurationHash({
      projectId: thread.projectId,
      instanceId: thread.modelSelection.instanceId,
      model: n2itionResolvedModel(thread.modelSelection.model, identity, true),
      options,
      identity,
      privateRoute: required,
      accountRouting: settings.accountRouting,
      sourcePaths: [...sourcePaths].sort(),
    }),
  };
}
