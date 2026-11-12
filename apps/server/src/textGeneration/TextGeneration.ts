import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { ModelSelection, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
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
import * as TextGenerators from "./TextGenerators.ts";
import * as TextGenerationOperations from "@t3tools/provider-core/server/textGenerationOperations";

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
  TranscriptionPostProcessingInput,
  TranscriptionPostProcessingResult,
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
  | "generateReviewGuide"
  | "generateTranscriptionPostProcessing";

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
  const sourceControl = yield* SourceControlProviderRegistry.SourceControlProviderRegistry;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGenerators = yield* TextGenerators.TextGenerators;
  const generate = Effect.fn("TextGeneration.generate")(function* <A extends object>(
    operation: TextGenerationOp,
    input: {
      readonly modelSelection: ModelSelection;
      readonly cwd: string;
      readonly projectId?: ProjectId | null | undefined;
      readonly threadId?: ThreadId;
    },
    invoke: (
      service: ProviderTextGeneration,
      modelSelection: ModelSelection,
      isPrivate: boolean,
    ) => Effect.Effect<A, TextGenerationError>,
  ) {
    const context = {
      cwd: input.cwd,
      ...(input.projectId == null ? {} : { projectId: input.projectId }),
      ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
    };
    const route = yield* routing
      .backgroundModel({ ...context, modelSelection: input.modelSelection })
      .pipe(
        Effect.mapError(
          (cause) => new TextGenerationError({ operation, detail: cause.message, cause }),
        ),
      );
    let selection = route.modelSelection;
    const projectId = input.projectId;
    if (operation === "generateProjectBrief") {
      const settings = yield* serverSettings.getRoutingSettings.pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation,
              detail:
                "Project brief provider settings are unavailable. Retry after reconnecting the environment.",
              cause,
            }),
        ),
      );
      if (
        !resolveProjectProviderInstanceEnabled(settings, projectId ?? null, selection.instanceId)
      ) {
        return yield* new TextGenerationError({
          operation,
          detail:
            "The effective project brief provider is disabled for this project. Enable it or select another text-generation model.",
        });
      }
    }
    const invokeSelected = (service: ProviderTextGeneration) =>
      invoke(service, selection, route.private).pipe(
        Effect.map((result) => ({ ...result, modelSelection: selection })),
      );
    const textGenerator = yield* textGenerators.runner(selection.instanceId);
    // A review guide reaches a text generator only through a fallback; it needs an agent instead.
    const textGeneratorId = selection.instanceId;
    const textGeneratorCannotRun =
      textGenerator !== undefined && operation === "generateReviewGuide";
    if (textGenerator !== undefined && !textGeneratorCannotRun) {
      return yield* invokeSelected(
        TextGenerationOperations.fromRunner("TextGenerator", textGenerator),
      );
    }
    const snapshots = yield* registry.listInstances.pipe(
      Effect.flatMap((instances) =>
        Effect.forEach(instances, (instance) => instance.snapshot.getSnapshot),
      ),
    );
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    const selected = snapshots.find((provider) => provider.instanceId === selection.instanceId);
    // Only a failed probe counts: a pending one is also not installed yet.
    const unusable =
      textGeneratorCannotRun ||
      (selected?.enabled === true &&
        selected.status === "error" &&
        (!selected.installed || selected.auth.status === "unauthenticated"));
    if (
      !route.private &&
      operation !== "generateProjectBrief" &&
      (unusable || exhaustedUsageWindow(selected, now, selection.model))
    ) {
      const settings = yield* serverSettings.getSettings.pipe(
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
        settings.providerInstances,
        (instanceId, driver) => {
          const provider = snapshots.find((candidate) => candidate.instanceId === instanceId);
          return (
            instanceId !== selection.instanceId &&
            provider?.enabled === true &&
            resolveProjectProviderInstanceEnabled(settings, projectId ?? null, instanceId) &&
            provider.installed &&
            provider.auth.status !== "unauthenticated" &&
            provider.status !== "error" &&
            isProviderAvailable(provider) &&
            isProviderTextGenerationCapable(provider) &&
            (operation !== "generateReviewGuide" || INVESTIGATING_DRIVERS.has(driver)) &&
            !exhaustedUsageWindow(provider, now, defaultTextGenerationModel(driver))
          );
        },
        { includeConfiguredInstances: true },
      );
      if (fallback !== null) {
        selection = (yield* routing
          .backgroundModel({ ...context, modelSelection: fallback })
          .pipe(
            Effect.mapError(
              (cause) => new TextGenerationError({ operation, detail: cause.message, cause }),
            ),
          )).modelSelection;
      }
    }
    if (textGeneratorCannotRun && selection.instanceId === textGeneratorId) {
      return yield* new TextGenerationError({
        operation,
        detail:
          "Review guides need a coding agent that can read the checkout. None is ready. Pick Codex or Claude as the review guide model in Settings → Source control.",
      });
    }
    return yield* resolveInstance(registry, operation, selection.instanceId).pipe(
      Effect.flatMap(invokeSelected),
    );
  });
  return TextGeneration.of({
    generateProjectBrief: Effect.fn("TextGeneration.generateProjectBrief")((input) =>
      generate("generateProjectBrief", input, (service, modelSelection) =>
        service.generateProjectBrief({ ...input, modelSelection }),
      ),
    ),
    generateCommitMessage: Effect.fn("TextGeneration.generateCommitMessage")(function (input) {
      return generate("generateCommitMessage", input, (service, modelSelection) =>
        service.generateCommitMessage({ ...input, modelSelection }),
      );
    }),
    generatePrContent: Effect.fn("TextGeneration.generatePrContent")(function (input) {
      return generate("generatePrContent", input, (service, modelSelection) =>
        service.generatePrContent({ ...input, modelSelection }),
      );
    }),
    generateBranchName: Effect.fn("TextGeneration.generateBranchName")(function (input) {
      return generate("generateBranchName", input, (service, modelSelection) =>
        service.generateBranchName({ ...input, modelSelection }),
      );
    }),
    generateReviewGuide: Effect.fn("TextGeneration.generateReviewGuide")(function (input) {
      return generate("generateReviewGuide", input, (service, modelSelection) =>
        service.generateReviewGuide({ ...input, modelSelection }),
      );
    }),
    generateTranscriptionPostProcessing: Effect.fn(
      "TextGeneration.generateTranscriptionPostProcessing",
    )(function (input) {
      return generate("generateTranscriptionPostProcessing", input, (service, modelSelection) =>
        service.generateTranscriptionPostProcessing({ ...input, modelSelection }),
      );
    }),
    generateThreadTitle: Effect.fn("TextGeneration.generateThreadTitle")(function (input) {
      return generate("generateThreadTitle", input, (textGeneration, modelSelection, isPrivate) =>
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
          return yield* textGeneration.generateThreadTitle({
            ...input,
            linkedContext,
            modelSelection,
          });
        }),
      );
    }),
  });
});

export const layer = Layer.effect(TextGeneration, make).pipe(
  Layer.provideMerge(TextGenerators.layer),
  Layer.provide(ModelRouting.layer),
);
