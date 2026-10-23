import { privateInferenceConfigurationHash } from "@t3tools/shared/providerConfigurationHash";
import {
  type ModelSelection,
  type OrchestrationV2AppThread,
  type PrivateModelRoute,
  type ProjectId,
  resolveProjectProviderInstanceEnabled,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class ModelRoutingError extends Schema.TaggedError<ModelRoutingError>()(
  "ModelRoutingError",
  {
    reason: Schema.Literals([
      "setup-required",
      "route-changed",
      "destination-blocked",
      "context-unavailable",
      "fresh-thread-required",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "setup-required":
        return "Private model routing requires an approved Tinfoil connection.";
      case "route-changed":
        return "The approved private connection changed or became unavailable. Private model requests are paused.";
      case "destination-blocked":
        return "Private model routing blocked this destination. Use the approved private connection.";
      case "fresh-thread-required":
        return "Start a fresh private thread to work in this private project. The existing thread retains its earlier disclosure history.";
      case "context-unavailable":
        return "Private model routing could not establish the request's project and thread restrictions.";
    }
  }
}

export function privateProviderConfigHash(
  settings: ServerSettings,
  selection: ModelSelection,
): string {
  return privateInferenceConfigurationHash(
    settings.providerInstances[selection.instanceId] ?? null,
  );
}

export const isModelRoutingError = Schema.is(ModelRoutingError);

export function isPrivateInferenceSelection(
  settings: ServerSettings,
  selection: Pick<ModelSelection, "instanceId">,
): boolean {
  return (
    (
      settings.providerInstances[selection.instanceId]?.config as
        | { privateInference?: unknown }
        | undefined
    )?.privateInference === "tinfoil"
  );
}

export function projectRequiresPrivateModels(
  settings: ServerSettings,
  projectId: ProjectId,
): boolean {
  return (
    (settings.projectSettingsOverrides[projectId]?.modelPrivacy ?? settings.modelPrivacy) ===
    "private"
  );
}

export function requiredPrivateRoute(
  settings: ServerSettings,
  thread: Pick<OrchestrationV2AppThread, "projectId" | "privateModelRoute">,
): PrivateModelRoute | null | undefined {
  const route =
    thread.privateModelRoute ??
    (projectRequiresPrivateModels(settings, thread.projectId) ? settings.privateModelRoute : null);
  if (route === null && projectRequiresPrivateModels(settings, thread.projectId)) return undefined;
  return route;
}

export const validatePrivateRoute = Effect.fn("ModelRouting.validatePrivateRoute")(function* (
  settings: ServerSettings,
  route: PrivateModelRoute,
  projectId: ProjectId | null,
) {
  const selection = route.modelSelection;
  const instance = settings.providerInstances[selection.instanceId];
  const config = instance?.config as
    | { privateInference?: unknown; serverUrl?: unknown }
    | undefined;
  // This release qualifies the isolated OpenCode/Tinfoil connector. Other connections need their own qualification.
  if (
    instance?.driver !== "opencode" ||
    config?.privateInference !== "tinfoil" ||
    (typeof config.serverUrl === "string" && config.serverUrl.trim() !== "") ||
    !selection.model.startsWith("tinfoil/") ||
    !resolveProjectProviderInstanceEnabled(settings, projectId, selection.instanceId) ||
    privateProviderConfigHash(settings, selection) !== route.providerConfigHash
  ) {
    return yield* new ModelRoutingError({ reason: "route-changed" });
  }
});

export const assertPrivateModelSelection = Effect.fn("ModelRouting.assertPrivateModelSelection")(
  function* (
    settings: ServerSettings,
    thread: Pick<OrchestrationV2AppThread, "projectId" | "privateModelRoute">,
    selection: ModelSelection,
  ) {
    const required = requiredPrivateRoute(settings, thread);
    const route =
      required === null && isPrivateInferenceSelection(settings, selection)
        ? (settings.privateModelRoute ?? undefined)
        : required;
    if (route === undefined) return yield* new ModelRoutingError({ reason: "setup-required" });
    if (route === null) return;
    yield* validatePrivateRoute(settings, route, thread.projectId);
    if (
      selection.instanceId !== route.modelSelection.instanceId ||
      !selection.model.startsWith("tinfoil/")
    )
      return yield* new ModelRoutingError({ reason: "destination-blocked" });
  },
);
