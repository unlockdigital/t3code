import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import {
  isProviderAvailable,
  isProviderTextGenerationCapable,
  resolveProjectProviderInstanceEnabled,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { exhaustedUsageWindow } from "@t3tools/shared/usageLimits";
import {
  defaultTextGenerationModel,
  fallbackTextGenerationModelSelection,
} from "@t3tools/shared/serverSettings";
import * as ServerSettings from "../serverSettings.ts";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";
import { TextGenerationError } from "@t3tools/contracts";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as ThreadTitleLinks from "./ThreadTitleLinks.ts";
import * as ModelRouting from "../privacy/ModelRouting.ts";

export type {
  BranchNameGenerationInput,
  BranchNameGenerationResult,
  CommitMessageGenerationInput,
  CommitMessageGenerationResult,
  PrContentGenerationInput,
  PrContentGenerationResult,
  ProjectBriefGenerationInput,
  ProjectBriefGenerationResult,
  ReviewGuideGenerationInput,
  ReviewGuideGenerationResult,
  ThreadTitleGenerationInput,
  ThreadTitleGenerationResult,
} from "@t3tools/provider-core/server/textGeneration";

export class TextGeneration extends Context.Service<TextGeneration, ProviderTextGeneration>()(
  "t3/textGeneration/TextGeneration",
) {}

type TextGenerationOp =
  | "generateProjectBrief"
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle"
  | "generateReviewGuide";

const resolveInstance = (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
  operation: TextGenerationOp,
  instanceId: ProviderInstanceId,
): Effect.Effect<ProviderInstance["textGeneration"], TextGenerationError> =>
  registry.getInstance(instanceId).pipe(
    Effect.flatMap((instance) =>
      instance
        ? Effect.succeed(instance.textGeneration)
        : Effect.fail(
            new TextGenerationError({
              operation,
              detail: `No provider instance registered for id '${instanceId}'.`,
            }),
          ),
    ),
  );

// Review guides investigate the checkout read-only; the other drivers reject that request.
const INVESTIGATING_DRIVERS = new Set(["codex", "claudeAgent"]);

/** @public */
export const make = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const routing = yield* ModelRouting.ModelRouting;
  const settings = yield* ServerSettings.ServerSettingsService;
  const sourceControl = yield* SourceControlProviderRegistry.SourceControlProviderRegistry;
  const routed = Effect.fn("TextGeneration.route")(function* <
    I extends ModelRouting.ModelRequestContext & { modelSelection: ModelSelection },
    A extends object,
  >(
    operation: TextGenerationOp,
    input: I,
    use: (
      generation: ProviderTextGeneration,
      input: I,
      isPrivate: boolean,
    ) => Effect.Effect<A, TextGenerationError>,
  ) {
    const route = yield* routing
      .backgroundModel(input)
      .pipe(
        Effect.mapError(
          (cause) => new TextGenerationError({ operation, detail: cause.message, cause }),
        ),
      );
    if (
      operation === "generateProjectBrief" &&
      !resolveProjectProviderInstanceEnabled(
        yield* settings.getSettings.pipe(
          Effect.mapError(
            (cause) =>
              new TextGenerationError({
                operation,
                detail:
                  "Project brief provider settings are unavailable. Retry after reconnecting the environment.",
                cause,
              }),
          ),
        ),
        input.projectId ?? null,
        route.modelSelection.instanceId,
      )
    ) {
      return yield* new TextGenerationError({
        operation,
        detail:
          "The effective project brief provider is disabled for this project. Enable it or select another text-generation model.",
      });
    }
    let selection = route.modelSelection;
    if (!route.private && operation !== "generateProjectBrief") {
      const snapshots = yield* registry.listInstances.pipe(
        Effect.flatMap((instances) =>
          Effect.forEach(instances, (instance) => instance.snapshot.getSnapshot),
        ),
      );
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      if (
        exhaustedUsageWindow(
          snapshots.find((provider) => provider.instanceId === selection.instanceId),
          now,
          selection.model,
        )
      ) {
        const fallbackSettings = yield* settings.getSettings.pipe(
          Effect.mapError(
            (cause) =>
              new TextGenerationError({
                operation,
                detail: "Could not read fallback model settings.",
                cause,
              }),
          ),
        );
        const fallback = fallbackTextGenerationModelSelection(
          fallbackSettings.providerInstances,
          (instanceId, driver) => {
            const provider = snapshots.find((candidate) => candidate.instanceId === instanceId);
            return (
              instanceId !== selection.instanceId &&
              provider?.enabled === true &&
              resolveProjectProviderInstanceEnabled(
                fallbackSettings,
                input.projectId ?? null,
                instanceId,
              ) &&
              provider.installed &&
              provider.auth.status !== "unauthenticated" &&
              isProviderAvailable(provider) &&
              isProviderTextGenerationCapable(provider) &&
              (operation !== "generateReviewGuide" || INVESTIGATING_DRIVERS.has(driver)) &&
              !exhaustedUsageWindow(provider, now, defaultTextGenerationModel(driver))
            );
          },
          { includeConfiguredInstances: true },
        );
        if (fallback !== undefined) {
          const checked = yield* routing
            .backgroundModel({ ...input, modelSelection: fallback })
            .pipe(
              Effect.mapError(
                (cause) => new TextGenerationError({ operation, detail: cause.message, cause }),
              ),
            );
          selection = checked.modelSelection;
        }
      }
    }
    const generation = yield* resolveInstance(registry, operation, selection.instanceId);
    const result = yield* use(generation, { ...input, modelSelection: selection }, route.private);
    return { ...result, modelSelection: selection };
  });
  return TextGeneration.of({
    generateProjectBrief: Effect.fn("TextGeneration.generateProjectBrief")((input) =>
      routed(
        "generateProjectBrief",
        {
          projectId: input.projectId,
          cwd: input.cwd,
          sourceText: input.sourceText,
          modelSelection: input.modelSelection,
        },
        (generation, value) => generation.generateProjectBrief(value),
      ),
    ),
    generateCommitMessage: Effect.fn("TextGeneration.generateCommitMessage")((input) =>
      routed("generateCommitMessage", input, (generation, value) =>
        generation.generateCommitMessage(value),
      ),
    ),
    generatePrContent: Effect.fn("TextGeneration.generatePrContent")((input) =>
      routed("generatePrContent", input, (generation, value) =>
        generation.generatePrContent(value),
      ),
    ),
    generateBranchName: Effect.fn("TextGeneration.generateBranchName")((input) =>
      routed("generateBranchName", input, (generation, value) =>
        generation.generateBranchName(value),
      ),
    ),
    generateReviewGuide: Effect.fn("TextGeneration.generateReviewGuide")((input) =>
      routed("generateReviewGuide", input, (generation, value) =>
        generation.generateReviewGuide(value),
      ),
    ),
    generateThreadTitle: Effect.fn("TextGeneration.generateThreadTitle")((input) =>
      routed("generateThreadTitle", input, (textGeneration, input, isPrivate) =>
        Effect.gen(function* () {
          const linkedContext =
            input.linkedContext ??
            (isPrivate
              ? ""
              : yield* ThreadTitleLinks.resolveThreadTitleLinks(input).pipe(
                  Effect.provideService(
                    SourceControlProviderRegistry.SourceControlProviderRegistry,
                    sourceControl,
                  ),
                ));
          return yield* textGeneration.generateThreadTitle({ ...input, linkedContext });
        }),
      ),
    ),
  });
});

export const layer = Layer.effect(TextGeneration, make).pipe(Layer.provide(ModelRouting.layer));
