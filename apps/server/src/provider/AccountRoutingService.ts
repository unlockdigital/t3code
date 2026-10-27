import {
  AccountRoutingPreviewError,
  type AccountRoutingPreviewInput,
  type AccountRoutingPreviewResult,
  type OrchestrationV2AppThread,
  resolveProjectProviderInstanceEnabled,
} from "@t3tools/contracts";
import { selectAccountRouting, type AccountRoutingCandidate } from "@t3tools/shared/accountRouting";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as Settings from "../serverSettings.ts";
import {
  assertPrivateModelSelection,
  isPrivateInferenceSelection,
  requiredPrivateRoute,
} from "../privacy/modelRoutingPolicy.ts";
import * as ProviderRegistry from "./ProviderRegistry.ts";

export class AccountRoutingService extends Context.Service<
  AccountRoutingService,
  {
    readonly preview: (
      input: AccountRoutingPreviewInput,
      thread?: Pick<OrchestrationV2AppThread, "projectId" | "privateModelRoute">,
    ) => Effect.Effect<AccountRoutingPreviewResult, AccountRoutingPreviewError>;
  }
>()("t3/provider/AccountRoutingService") {}

const make = Effect.gen(function* () {
  const settingsService = yield* Settings.ServerSettingsService;
  const registry = yield* ProviderRegistry.ProviderRegistry;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const threads = yield* ProjectionStore.ProjectionStoreV2;

  const preview = Effect.fn("AccountRoutingService.preview")(function* (
    input: AccountRoutingPreviewInput,
    thread?: Pick<OrchestrationV2AppThread, "projectId" | "privateModelRoute">,
  ) {
    let threadContext = thread;
    if (threadContext === undefined && input.threadId !== undefined) {
      const stored = yield* threads
        .getThread(input.threadId)
        .pipe(
          Effect.mapError(() => new AccountRoutingPreviewError({ reason: "context-unavailable" })),
        );
      if (stored.deletedAt !== null)
        return yield* new AccountRoutingPreviewError({ reason: "context-unavailable" });
      threadContext = stored;
    }
    if (threadContext !== undefined && threadContext.projectId !== input.projectId)
      return yield* new AccountRoutingPreviewError({ reason: "context-unavailable" });
    const project = yield* projects
      .get(input.projectId)
      .pipe(
        Effect.mapError(() => new AccountRoutingPreviewError({ reason: "context-unavailable" })),
      );
    if (Option.isNone(project))
      return yield* new AccountRoutingPreviewError({ reason: "context-unavailable" });
    const settings = yield* settingsService.getRoutingSettings.pipe(
      Effect.mapError(() => new AccountRoutingPreviewError({ reason: "settings-unavailable" })),
    );
    const providers = yield* registry.getProviders;
    const context = threadContext ?? { projectId: input.projectId };
    const privateRequired =
      input.requirePrivateRoute === true || requiredPrivateRoute(settings, context) !== null;
    const candidates = yield* Effect.forEach(providers, (provider) =>
      Effect.gen(function* () {
        const selection = { ...input.requestedSelection, instanceId: provider.instanceId };
        const privateAllowed = yield* assertPrivateModelSelection(
          settings,
          context,
          selection,
        ).pipe(
          Effect.as(true),
          Effect.catch(() => Effect.succeed(false)),
        );
        // Published snapshots lack verified entitlement, funding control, auth epoch,
        // and per-item observation provenance. Preview keeps those facts unknown.
        return {
          instanceId: provider.instanceId,
          enabled: provider.enabled,
          projectEnabled: resolveProjectProviderInstanceEnabled(
            settings,
            input.projectId,
            provider.instanceId,
          ),
          authenticated: provider.auth.status === "authenticated",
          executionAllowed: provider.installed && provider.status === "ready" && privateAllowed,
          privateRoute: privateAllowed && isPrivateInferenceSelection(settings, selection),
          models: provider.models.map(({ slug, capabilities }) => ({ slug, capabilities })),
          identity: { status: "unknown" },
          localBusy: { status: "unknown" },
          entitlement: { status: "unknown" },
          modelScope: { status: "unknown" },
          includedWindowIds: { status: "unknown" },
          includedOnlyProtection: { status: "unknown" },
          creditAuthorization: { status: "unknown" },
          creditBalance: { status: "unknown" },
          creditCapWindowIds: { status: "unknown" },
          windows: [],
        } satisfies AccountRoutingCandidate;
      }),
    );
    const now = yield* DateTime.now;
    return selectAccountRouting(
      {
        policy: settings.accountRouting,
        request: { ...input, requirePrivateRoute: privateRequired },
        candidates,
      },
      DateTime.toEpochMillis(now),
    );
  });
  return AccountRoutingService.of({ preview });
});

export const layer = Layer.effect(AccountRoutingService, make);
