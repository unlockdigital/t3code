import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as WorkflowReview from "../../../workflowReview/WorkflowReview.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { WorkflowReviewToolkit } from "./tools.ts";

const failure = (error: WorkflowReview.WorkflowReviewError) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });
export const layer = McpToolAccess.toLayer(WorkflowReviewToolkit, {
  t3_workflow_digest: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const service = yield* WorkflowReview.WorkflowReview;
      return yield* service.digest(input.reviewId).pipe(Effect.mapError(failure));
    }),
  ),
  t3_workflow_excerpt: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const service = yield* WorkflowReview.WorkflowReview;
      return yield* service.excerpt(input).pipe(Effect.mapError(failure));
    }),
  ),
  t3_workflow_review_save: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const service = yield* WorkflowReview.WorkflowReview;
      return yield* service.save({ ...input, action: "complete" }).pipe(Effect.mapError(failure));
    }),
  ),
  t3_workflow_review_decide: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const service = yield* WorkflowReview.WorkflowReview;
      return yield* service.save({ ...input, action: "decide" }).pipe(Effect.mapError(failure));
    }),
  ),
});
