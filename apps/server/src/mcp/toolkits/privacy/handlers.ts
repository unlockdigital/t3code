import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as PrivateHelpers from "../../../privacy/PrivateHelpers.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { PrivacyToolkit } from "./tools.ts";

const privateCaller = Effect.gen(function* () {
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  if (invocation.thread === undefined)
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: "This tool requires the private coordinator's own thread.",
    });
  const helpers = yield* PrivateHelpers.PrivateHelpers;
  yield* helpers
    .checkCoordinator(invocation.thread.threadId, invocation.thread.providerInstanceId)
    .pipe(
      Effect.mapError(
        () =>
          new OrchestratorMcpFailure({
            code: "capability_denied",
            message:
              "Only this thread's approved private coordinator can access its helper packets.",
          }),
      ),
    );
  return invocation.thread.threadId;
});

export const layer = McpToolAccess.toLayer(PrivacyToolkit, {
  private_helper_propose: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const threadId = yield* privateCaller;
      const service = yield* PrivateHelpers.PrivateHelpers;
      return yield* service
        .propose({ ...input, threadId })
        .pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
          ),
        );
    }),
  ),
  private_helper_status: McpToolAccess.writes(() =>
    Effect.gen(function* () {
      const threadId = yield* privateCaller;
      const service = yield* PrivateHelpers.PrivateHelpers;
      return yield* service
        .state(threadId)
        .pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
          ),
        );
    }),
  ),
});
