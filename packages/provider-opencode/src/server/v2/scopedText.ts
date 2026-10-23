import { Model, Provider } from "@opencode/client/effect";
import { type ModelSelection, PrivateHelperError } from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as OpenCode2Server from "./OpenCode2Server.ts";
import { parseOpenCodeModelSlug } from "../OpenCodeRuntime.ts";

export const make = Effect.gen(function* () {
  const server = yield* OpenCode2Server.OpenCode2Server;
  return Effect.fn("OpenCodeScopedText.generate")(function* (input: {
    readonly modelSelection: ModelSelection;
    readonly prompt: string;
  }) {
    const parsed = parseOpenCodeModelSlug(input.modelSelection.model);
    if (
      parsed === null ||
      (input.modelSelection.options ?? []).some((option) => option.id !== "variant")
    )
      return yield* new PrivateHelperError({ reason: "unavailable" });
    const variant = getModelSelectionStringOptionValue(input.modelSelection, "variant");
    return yield* server
      .withConnection((connection) =>
        Effect.gen(function* () {
          if (connection.external) return yield* new PrivateHelperError({ reason: "unavailable" });
          // generate.text accepts only a prompt and model. It creates no agent session or tool loop.
          return yield* connection.client.generate
            .text({
              prompt: input.prompt,
              model: Model.Ref.make({
                providerID: Provider.ID.make(parsed.providerID),
                id: Model.ID.make(parsed.modelID),
                ...(variant === undefined ? {} : { variant: Model.VariantID.make(variant) }),
              }),
            })
            .pipe(Effect.mapError(() => new PrivateHelperError({ reason: "execution-failed" })));
        }),
      )
      .pipe(
        Effect.timeout("3 minutes"),
        Effect.mapError(() => new PrivateHelperError({ reason: "execution-failed" })),
      );
  });
});
