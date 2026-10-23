import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
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
  ReviewGuideGenerationInput,
  ReviewGuideGenerationResult,
  ThreadTitleGenerationInput,
  ThreadTitleGenerationResult,
} from "@t3tools/provider-core/server/textGeneration";

export class TextGeneration extends Context.Service<TextGeneration, ProviderTextGeneration>()(
  "t3/textGeneration/TextGeneration",
) {}

type TextGenerationOp =
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

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const routing = yield* ModelRouting.ModelRouting;
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
    const generation = yield* resolveInstance(registry, operation, route.modelSelection.instanceId);
    const result = yield* use(
      generation,
      { ...input, modelSelection: route.modelSelection },
      route.private,
    );
    return { ...result, modelSelection: route.modelSelection };
  });
  return TextGeneration.of({
    generateCommitMessage: (input) =>
      routed("generateCommitMessage", input, (generation, value) =>
        generation.generateCommitMessage(value),
      ),
    generatePrContent: (input) =>
      routed("generatePrContent", input, (generation, value) =>
        generation.generatePrContent(value),
      ),
    generateBranchName: (input) =>
      routed("generateBranchName", input, (generation, value) =>
        generation.generateBranchName(value),
      ),
    generateReviewGuide: (input) =>
      routed("generateReviewGuide", input, (generation, value) =>
        generation.generateReviewGuide(value),
      ),
    generateThreadTitle: (input) =>
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
  });
});

export const layer = Layer.effect(TextGeneration, make).pipe(Layer.provide(ModelRouting.layer));
