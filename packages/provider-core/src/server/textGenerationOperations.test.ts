import { ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

import { fromRunner, type Runner } from "./textGenerationOperations.ts";

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
    expect(failure.message).toContain("does not support isolated project briefs");
    expect(run).not.toHaveBeenCalled();
  }),
);
