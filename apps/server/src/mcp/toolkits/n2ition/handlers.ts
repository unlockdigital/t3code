import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as N2itionContext from "../../../n2ition/N2itionContext.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { N2itionToolkit } from "./tools.ts";
export const layer = McpToolAccess.toLayer(N2itionToolkit, {
  n2ition_context_read: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* N2itionContext.N2itionContext;
      return yield* service
        .read(scope, input)
        .pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({ code: "capability_denied", message: error.message }),
          ),
        );
    }),
  ),
  n2ition_connection_status: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* N2itionContext.N2itionContext;
      return yield* service
        .callerStatus(scope)
        .pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({ code: "capability_denied", message: error.message }),
          ),
        );
    }),
  ),
});
