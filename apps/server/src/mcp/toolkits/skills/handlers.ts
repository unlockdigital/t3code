import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as SkillLibrary from "../../../skills/SkillLibrary.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import type { skillToolkit } from "./tools.ts";

export function handlers(toolkit: ReturnType<typeof skillToolkit>) {
  return McpToolAccess.toLayer(toolkit, {
    t3_skill_read: McpToolAccess.readsAsCaller((input) =>
      Effect.gen(function* () {
        const library = yield* SkillLibrary.SkillLibrary;
        return yield* library.read(input).pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({
                code: "invalid_request",
                message: error.message,
              }),
          ),
        );
      }),
    ),
  });
}
