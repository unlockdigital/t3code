import { ProjectId, ProviderInstanceId, TextGenerationError } from "@t3tools/contracts";
import { assert, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

import { decodeJsonReply, fromRunner, type Runner } from "./textGenerationOperations.ts";

it.effect("fails unsupported project briefs before executing a provider runner", () =>
  Effect.gen(function* () {
    const run = vi.fn<Runner>();
    const service = fromRunner("UnisolatedProvider", run);
    const failure = yield* service
      .generateProjectBrief({
        projectId: ProjectId.make("brief-project"),
        cwd: "/canonical/project",
        sourceText: "The project contains research software.",
        modelSelection: { instanceId: ProviderInstanceId.make("provider"), model: "model" },
      })
      .pipe(Effect.flip);
    expect(failure.operation).toBe("generateProjectBrief");
    expect(failure.message).toContain("does not support bounded project briefs");
    expect(run).not.toHaveBeenCalled();
  }),
);

// regression: #23726 a reply that echoes the schema key replaced the seed title with "title"
it.effect("fails a thread title reply that is only the schema key", () =>
  Effect.gen(function* () {
    const textGeneration = fromRunner("Stub", (request) =>
      decodeJsonReply(request, "Stub", '{"title":"title","needsRefinement":false}'),
    );

    const outcome = yield* textGeneration
      .generateThreadTitle({
        cwd: process.cwd(),
        message: "$implement Issue #140",
        modelSelection: {
          instanceId: ProviderInstanceId.make("pi"),
          model: "anthropic/claude-haiku-4-5",
        },
      })
      .pipe(Effect.match({ onFailure: (error) => error, onSuccess: (result) => result }));

    assert.instanceOf(outcome, TextGenerationError);
    assert.strictEqual(outcome.operation, "generateThreadTitle");
  }),
);
