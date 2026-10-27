import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as AccountRouting from "../../../provider/AccountRoutingService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readThread } from "../../threadAccess.ts";
import { AccountRoutingToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(AccountRoutingToolkit, {
  account_routing_preview: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      yield* McpInvocationContext.requireThreadMcpCapability("preview").pipe(
        Effect.mapError(
          (error) =>
            new OrchestratorMcpFailure({
              code: "capability_denied",
              message: error.message,
            }),
        ),
      );
      const { projection } = yield* readThread();
      if (
        input.projectId !== projection.thread.projectId ||
        (input.threadId !== undefined && input.threadId !== projection.thread.id)
      )
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "Preview the account policy within this thread's project.",
        });
      const routing = yield* AccountRouting.AccountRoutingService;
      return yield* routing.preview(input, projection.thread).pipe(
        Effect.mapError(
          () =>
            new OrchestratorMcpFailure({
              code: "invalid_request",
              message: "Account routing preview is unavailable for this project.",
            }),
        ),
      );
    }),
  ),
});
