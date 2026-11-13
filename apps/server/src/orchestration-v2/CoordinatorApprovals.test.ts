import * as Reactor from "./CoordinatorApprovalReactor.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as Projections from "./ProjectionStore.ts";
import { EventId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import {
  ThreadId,
  RunId,
  MessageId,
  RuntimeRequestId,
  NodeId,
  ProviderSessionId,
  TurnItemId,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import * as Approvals from "./CoordinatorApprovals.ts";
import * as Threads from "./ThreadManagementService.ts";
import * as Settings from "../serverSettings.ts";
import { liveThreadShell, idleThreadProjection } from "../mcp/McpToolAccess.testkit.ts";

const parentId = ThreadId.make("coordinator");
const childId = ThreadId.make("owned-child");
const runId = RunId.make("child-run");
const messageId = MessageId.make("assignment");
const requestId = RuntimeRequestId.make("approval");
const input = { coordinatorThreadId: parentId, threadId: childId, requestId };
function setup() {
  const parent = liveThreadShell(parentId, { runtimeMode: "approval-required" });
  const shell = {
    ...liveThreadShell(childId, { runtimeMode: "approval-required" }),
    createdBy: "agent" as const,
    creationSource: "mcp" as const,
  };
  const now = shell.createdAt;
  let projection: OrchestrationV2ThreadProjection = {
    ...idleThreadProjection(shell),
    runs: [
      {
        id: runId,
        threadId: childId,
        ordinal: 1,
        providerInstanceId: shell.providerInstanceId,
        modelSelection: shell.modelSelection,
        providerThreadId: null,
        userMessageId: messageId,
        rootNodeId: null,
        activeAttemptId: null,
        status: "running",
        requestedAt: now,
        startedAt: now,
        completedAt: null,
        checkpointId: null,
        contextHandoffId: null,
      },
    ],
    messages: [
      {
        id: messageId,
        threadId: childId,
        runId,
        nodeId: null,
        role: "user",
        text: "Inspect local source files",
        senderThreadId: parentId,
        createdBy: "agent",
        creationSource: "mcp",
        attachments: [],
        streaming: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
    runtimeRequests: [
      {
        id: requestId,
        nodeId: NodeId.make("approval-node"),
        providerTurnId: null,
        nativeRequestRef: null,
        kind: "command",
        status: "pending",
        responseCapability: { type: "live", providerSessionId: ProviderSessionId.make("session") },
        createdAt: now,
        resolvedAt: null,
      },
    ],
    turnItems: [
      {
        id: TurnItemId.make("approval-item"),
        threadId: childId,
        runId,
        nodeId: NodeId.make("approval-node"),
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 1,
        status: "waiting",
        title: null,
        startedAt: now,
        completedAt: null,
        updatedAt: now,
        type: "approval_request",
        requestId,
        requestKind: "command",
        prompt: "Command: rg --files src",
        approvalCommand: { command: "rg --files src", cwd: "/workspace" },
      },
    ],
  };
  const dispatched: OrchestrationV2ServerCommand[] = [];
  const threads = Layer.mock(Threads.ThreadManagementService)({
    getThreadShell: (id) => Effect.succeed(id === parentId ? parent : shell),
    getProjectThreadRecords: () => Effect.succeed(projection),
    dispatch: (command) =>
      Effect.sync(() => {
        dispatched.push(command);
        return { sequence: 7, storedEvents: [] };
      }),
  });
  const layer = Approvals.layer.pipe(Layer.provide(threads), Layer.provide(NodeCrypto.layer));
  return {
    layer,
    dispatched,
    get: () => projection,
    set: (next: OrchestrationV2ThreadProjection) => {
      projection = next;
    },
  };
}

it.effect("requires a user grant and issues only a single-action approval", () => {
  const f = setup();
  return Effect.gen(function* () {
    const approvals = yield* Approvals.CoordinatorApprovals;
    const settings = yield* Settings.ServerSettingsService;
    expect((yield* Effect.flip(approvals.read(input))).code).toBe("capability_denied");
    yield* settings.updateSettings({ approvalCoordinatorThreadIds: [parentId] });
    const review = yield* approvals.read(input);
    const result = yield* approvals.approve({
      ...input,
      snapshot: review.snapshot,
      category: "search",
      rationale: "Lists source filenames within the assigned repository.",
    });
    expect(result.decision).toBe("accept");
    expect(f.dispatched).toMatchObject([
      { type: "runtime-request.respond", decision: "accept", threadId: childId, requestId },
    ]);
    yield* settings.updateSettings({ approvalCoordinatorThreadIds: [] });
    expect((yield* Effect.flip(approvals.read(input))).code).toBe("capability_denied");
  }).pipe(Effect.provide(f.layer.pipe(Layer.provideMerge(Settings.layerTest()))));
});

it.effect(
  "refuses stale snapshots, answered requests, unrelated work, and human-only requests",
  () => {
    const f = setup();
    return Effect.gen(function* () {
      const approvals = yield* Approvals.CoordinatorApprovals;
      const original = f.get();
      const review = yield* approvals.read(input);
      const approve = () =>
        approvals.approve({
          ...input,
          snapshot: review.snapshot,
          category: "read",
          rationale: "Read assigned source.",
        });
      expect(
        (yield* Effect.flip(
          approvals.approve({
            ...input,
            snapshot: "outdated",
            category: "read",
            rationale: "Read source",
          }),
        )).code,
      ).toBe("capability_denied");
      f.set({
        ...original,
        runtimeRequests: original.runtimeRequests.map((request) => ({
          ...request,
          status: "resolved",
        })),
      });
      expect((yield* Effect.flip(approve())).code).toBe("capability_denied");
      f.set({
        ...original,
        messages: original.messages.map((message) => ({
          ...message,
          senderThreadId: ThreadId.make("someone-else"),
        })),
      });
      expect((yield* Effect.flip(approve())).code).toBe("capability_denied");
      f.set({
        ...original,
        turnItems: original.turnItems.map((item) =>
          item.type === "approval_request" ? { ...item, fullAccessOverride: "ask_rule" } : item,
        ),
      });
      expect((yield* approvals.read(input)).humanOnly).toBe(true);
      expect((yield* Effect.flip(approve())).code).toBe("capability_denied");
      expect(f.dispatched).toHaveLength(0);
    }).pipe(
      Effect.provide(
        f.layer.pipe(
          Layer.provideMerge(Settings.layerTest({ approvalCoordinatorThreadIds: [parentId] })),
        ),
      ),
    );
  },
);

it.effect(
  "wakes the configured owner for a pending approval and leaves other threads alone",
  () => {
    const f = setup();
    const projection = f.get();
    const request = projection.runtimeRequests[0]!;
    const event = {
      id: EventId.make("request-event"),
      type: "runtime-request.updated" as const,
      threadId: childId,
      runId,
      occurredAt: projection.updatedAt,
      payload: request,
    };
    const commands: OrchestrationV2ServerCommand[] = [];
    return Effect.gen(function* () {
      const reactor = yield* Reactor.CoordinatorApprovalReactor;
      const settings = yield* Settings.ServerSettingsService;
      yield* reactor.handle(event);
      expect(commands).toHaveLength(0);
      yield* settings.updateSettings({ approvalCoordinatorThreadIds: [parentId] });
      yield* reactor.handle(event);
      expect(commands).toMatchObject([
        {
          type: "message.dispatch",
          threadId: parentId,
          dispatchMode: { type: "queue_after_active" },
        },
      ]);
      expect(commands[0]?.type === "message.dispatch" && commands[0].text).toContain(
        "t3_approval_read",
      );
      f.set({
        ...projection,
        messages: projection.messages.map((message) => ({
          ...message,
          senderThreadId: ThreadId.make("unrelated"),
        })),
      });
      yield* reactor.handle(event);
      expect(commands).toHaveLength(1);
    }).pipe(
      Effect.provide(
        Reactor.layer.pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              Settings.layerTest(),
              Layer.mock(Projections.ProjectionStoreV2)({
                getThreadRecords: (id) =>
                  Effect.succeed(
                    id === childId ? f.get() : idleThreadProjection(liveThreadShell(parentId)),
                  ),
              }),
              Layer.mock(Orchestrator.OrchestratorV2)({
                dispatch: (command) =>
                  Effect.sync(() => {
                    commands.push(command);
                    return { sequence: 1, storedEvents: [] };
                  }),
              }),
            ),
          ),
        ),
      ),
    );
  },
);
