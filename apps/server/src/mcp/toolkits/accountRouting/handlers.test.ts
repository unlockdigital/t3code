import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type AccountRoutingPreviewInput,
  type AccountRoutingPreviewResult,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/ai";

import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as AccountRouting from "../../../provider/AccountRoutingService.ts";
import { privateProviderConfigHash } from "../../../privacy/modelRoutingPolicy.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { idleThreadProjection, liveThreadShell } from "../../McpToolAccess.testkit.ts";
import { AccountRoutingToolkit } from "./tools.ts";
import * as AccountRoutingHandlers from "./handlers.ts";

const projectId = ProjectId.make("project:account-routing");
const threadId = ThreadId.make("thread:account-routing");
const privateInstanceId = ProviderInstanceId.make("private-account");
const selection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" };
const previewResult = {
  status: "blocked",
  evaluatedAt: "2026-10-24T12:00:00.000Z",
  mode: null,
  requestedSelection: selection,
  target: null,
  selectedStageId: null,
  reasons: ["policyMissing"],
  stages: [],
  nextRefreshAt: null,
  dispatchAllowed: false,
  activationBlockers: ["previewOnly", "policyMissing"],
  policySnapshot: null,
} satisfies AccountRoutingPreviewResult;
const input = {
  projectId,
  requestedSelection: selection,
} satisfies AccountRoutingPreviewInput;

const makeHarness = Effect.fn("makeAccountRoutingMcpHarness")(function* (
  options: {
    readonly capabilities?: ReadonlyArray<McpInvocationContext.McpCapability>;
    readonly projectId?: ProjectId;
    readonly privateRoute?: boolean;
    readonly approvedPrivateCaller?: boolean;
  } = {},
) {
  const calls = yield* Ref.make<
    ReadonlyArray<{ input: AccountRoutingPreviewInput; thread: unknown }>
  >([]);
  const shell = liveThreadShell(threadId);
  const route = options.privateRoute
    ? {
        modelSelection: { instanceId: privateInstanceId, model: "tinfoil/kimi-k3" },
        providerConfigHash: privateProviderConfigHash(
          {
            ...DEFAULT_SERVER_SETTINGS,
            providerInstances: {
              [privateInstanceId]: {
                driver: ProviderDriverKind.make("opencode"),
                enabled: true,
                config: { privateInference: "tinfoil", serverUrl: "" },
              },
            },
          },
          { instanceId: privateInstanceId, model: "tinfoil/kimi-k3" },
        ),
      }
    : undefined;
  const thread = {
    ...shell,
    projectId: options.projectId ?? projectId,
    ...(route === undefined ? {} : { modelSelection: route.modelSelection }),
    ...(route === undefined ? {} : { privateModelRoute: route }),
  };
  const settings = {
    ...DEFAULT_SERVER_SETTINGS,
    ...(route === undefined
      ? {}
      : {
          providerInstances: {
            [privateInstanceId]: {
              driver: ProviderDriverKind.make("opencode"),
              enabled: true,
              config: { privateInference: "tinfoil", serverUrl: "" },
            },
          },
          privateModelRoute: route,
        }),
  };
  const dependencies = Layer.mergeAll(
    ServerSettings.layerTest(settings),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: (id) => Effect.succeed(id === threadId ? thread : null),
      getProjectThreadRecords: () => Effect.succeed(idleThreadProjection(thread)),
    }),
    Layer.succeed(AccountRouting.AccountRoutingService, {
      preview: (previewInput, target) =>
        Ref.update(calls, (seen) => [...seen, { input: previewInput, thread: target }]).pipe(
          Effect.as(previewResult),
        ),
    }),
  );
  const toolkit = yield* AccountRoutingToolkit.pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(AccountRoutingHandlers.layer).pipe(
        Layer.provide(dependencies),
      ),
    ),
  );
  const call = (params: AccountRoutingPreviewInput = input) =>
    toolkit.handle("account_routing_preview", params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map(
        (chunk) =>
          chunk.at(-1)!.result as Tool.Result<
            typeof AccountRoutingToolkit.tools.account_routing_preview
          >,
      ),
      Effect.provideService(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("environment:account-routing"),
        requestNamespace: "account-routing-test",
        thread: {
          threadId,
          providerSessionId: "session:account-routing",
          providerInstanceId: options.approvedPrivateCaller
            ? privateInstanceId
            : shell.providerInstanceId,
        },
        client: {
          sessionId: "readonly-client",
          label: "Read only test client",
          access: "read-only",
        },
        capabilities: new Set<McpInvocationContext.McpCapability>(
          options.capabilities ?? ["orchestration", "preview"],
        ),
        issuedAt: 1,
      }),
      Effect.provide(dependencies),
    );
  return { call, calls };
});

it.effect("lets a read-only caller preview its own project's thread through the service", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    const result = yield* harness.call();
    expect(result).toEqual(previewResult);
    expect(yield* Ref.get(harness.calls)).toHaveLength(1);
    expect((yield* Ref.get(harness.calls))[0]).toMatchObject({
      input,
      thread: { id: threadId, projectId },
    });
  }),
);

it.effect("rejects a cross-project preview before calling the service", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    const error = yield* harness.call({ ...input, projectId: ProjectId.make("project:other") });
    expect(error).toMatchObject({ code: "capability_denied" });
    expect(yield* Ref.get(harness.calls)).toEqual([]);
  }),
);

it.effect("requires orchestration capability before previewing", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({ capabilities: ["preview"] });
    const error = yield* harness.call();
    expect(error).toMatchObject({ code: "capability_denied" });
    expect(yield* Ref.get(harness.calls)).toEqual([]);
  }),
);

it.effect("requires preview capability before accessing the account preview", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({ capabilities: ["orchestration"] });
    expect(yield* harness.call()).toMatchObject({ code: "capability_denied" });
    expect(yield* Ref.get(harness.calls)).toEqual([]);
  }),
);

it.effect("rejects a foreign thread reference before calling the preview service", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    const error = yield* harness.call({ ...input, threadId: ThreadId.make("thread:other") });
    expect(error).toMatchObject({ code: "capability_denied" });
    expect(yield* Ref.get(harness.calls)).toEqual([]);
  }),
);

it.effect("applies the approved private-caller check before previewing a private thread", () =>
  Effect.gen(function* () {
    const denied = yield* makeHarness({ privateRoute: true });
    const deniedError = yield* denied.call({ ...input, requirePrivateRoute: true });
    expect(deniedError).toMatchObject({ code: "capability_denied" });
    expect(yield* Ref.get(denied.calls)).toEqual([]);

    const approved = yield* makeHarness({ privateRoute: true, approvedPrivateCaller: true });
    const approvedResult = yield* approved.call({ ...input, requirePrivateRoute: true });
    expect(approvedResult).toMatchObject({ dispatchAllowed: false });
    expect(yield* Ref.get(approved.calls)).toHaveLength(1);
  }),
);
