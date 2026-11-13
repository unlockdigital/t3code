import {
  CommandId,
  MessageId,
  type OrchestrationV2DomainEvent,
  type RuntimeRequestId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import { coordinatorOwnsRun, policy } from "./CoordinatorApprovals.ts";
import { forkParked } from "../serverActivation.ts";

export class CoordinatorApprovalReactor extends Context.Service<
  CoordinatorApprovalReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly handle: (event: OrchestrationV2DomainEvent) => Effect.Effect<void>;
  }
>()("t3/orchestration-v2/CoordinatorApprovalReactor") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const settings = yield* ServerSettings.ServerSettingsService;
  const review = Effect.fn("CoordinatorApprovalReactor.review")(function* (
    threadId: ThreadId,
    requestId: RuntimeRequestId,
  ) {
    const grants = (yield* settings.getSettings).approvalCoordinatorThreadIds;
    if (grants.length === 0) return;
    const child = yield* projections.getThreadRecords(threadId, [
      "messages",
      "runs",
      "runtimeRequests",
      "turnItems",
    ]);
    if (child.thread.deletedAt !== null || child.thread.archivedAt !== null) return;
    const item = child.turnItems.find(
      (item) => item.type === "approval_request" && item.requestId === requestId,
    );
    if (item?.type !== "approval_request") return;
    const coordinator = grants.find((id) => coordinatorOwnsRun(id, child, item.runId));
    if (!coordinator) return;
    const parent = yield* projections.getThreadRecords(coordinator, ["runs"]);
    if (parent.thread.deletedAt !== null || parent.thread.archivedAt !== null) return;
    const request = child.runtimeRequests.find((request) => request.id === requestId);
    const key = `${coordinator}:${threadId}:${requestId}`;
    const messageId = MessageId.make(`message:coordinator-approval:${key}`);
    if (request?.status !== "pending" || request.responseCapability.type !== "live") {
      const queued = parent.runs.find(
        (run) => run.userMessageId === messageId && run.status === "queued",
      );
      if (queued)
        yield* engine.dispatch({
          type: "queued-run.cancel",
          commandId: CommandId.make(`coordinator-approval-cancel:${key}`),
          threadId: coordinator,
          runId: queued.id,
        });
      return;
    }
    yield* engine.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(`coordinator-approval-wake:${key}`),
      threadId: coordinator,
      messageId,
      text: `A thread you started needs approval. Read the live request using t3_approval_read with threadId ${threadId} and requestId ${requestId}. Review its actual action and your assigned task. ${policy} Use t3_approval_approve_once with its current snapshot and a concrete rationale only if eligible. Otherwise leave it pending and ask the human with the thread link and concern. If the request is no longer live, report that and take no action.`,
      notification: {
        source: { kind: "system" },
        outcome: "updated",
        summary: "Your managed thread needs approval",
      },
      attachments: [],
      dispatchMode: { type: "queue_after_active" },
      createdBy: "agent",
      creationSource: "server",
    });
  });
  const handle: CoordinatorApprovalReactor["Service"]["handle"] = Effect.fn(
    "CoordinatorApprovalReactor.handle",
  )(
    function* (event) {
      if (
        event.type !== "runtime-request.updated" ||
        ["user_input", "auth_refresh", "dynamic_tool_call"].includes(event.payload.kind)
      )
        return;
      yield* review(event.threadId, event.payload.id);
    },
    Effect.catchCause((cause) =>
      Effect.logWarning("Coordinator approval notification failed", { cause }),
    ),
  );
  const catchUp = Effect.gen(function* () {
    if ((yield* settings.getSettings).approvalCoordinatorThreadIds.length === 0) return;
    const snapshot = yield* engine.getShellSnapshot();
    for (const thread of snapshot.threads) {
      if (!thread.pendingRuntimeRequest) continue;
      const { runtimeRequests } = yield* projections.getThreadRecords(thread.id, [
        "runtimeRequests",
      ]);
      for (const request of runtimeRequests) {
        if (request.status === "pending") yield* review(thread.id, request.id);
      }
    }
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Coordinator approval catch-up failed", { cause }),
    ),
  );
  const start = Effect.fn("CoordinatorApprovalReactor.start")(function* () {
    yield* forkParked(
      Stream.runForEach(engine.streamDomainEvents, handle).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Coordinator approval stream failed", { cause }),
        ),
      ),
    );
    const changes = yield* settings.subscribeChanges;
    yield* forkParked(
      changes.pipe(
        Stream.map((value) => JSON.stringify(value.approvalCoordinatorThreadIds)),
        Stream.changes,
        Stream.runForEach(() => catchUp),
      ),
    );
    yield* catchUp;
  });
  return { start, handle };
});
export const layer = Layer.effect(CoordinatorApprovalReactor, make);
