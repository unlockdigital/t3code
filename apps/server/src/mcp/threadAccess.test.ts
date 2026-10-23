import { expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { privateProviderConfigHash } from "../privacy/modelRoutingPolicy.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import { idleThreadProjection, liveThreadShell } from "./McpToolAccess.testkit.ts";
import { readThread } from "./threadAccess.ts";

const bareId = ThreadId.make("5d0b4a3e-8c1f-4a52-9d37-2f6c7e1b9a04");
const client: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment:thread-access"),
  requestNamespace: "client:thread-access",
  thread: undefined,
  client: { sessionId: "thread-access", label: "Claude Code", access: "full-access" },
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};

const readBare = (existing: ReadonlyArray<ThreadId>) =>
  readThread(bareId).pipe(
    Effect.flip,
    Effect.provideService(McpInvocationContext.McpInvocationContext, client),
    Effect.provide([
      ServerSettings.layerTest(),
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: (threadId) =>
          Effect.succeed(existing.includes(threadId) ? liveThreadShell(threadId) : null),
      }),
    ]),
  );

it.effect("points a bare uuid at the mcp: thread it belongs to", () =>
  Effect.gen(function* () {
    const error = yield* readBare([ThreadId.make(`mcp:${bareId}`)]);

    expect(error.code).toBe("thread_not_found");
    expect(error.message).toBe(`The thread was not found. Did you mean \`mcp:${bareId}\`?`);
  }),
);

it.effect("keeps the plain message for an id that matches nothing", () =>
  Effect.gen(function* () {
    const error = yield* readBare([]);

    expect(error.code).toBe("thread_not_found");
    expect(error.message).toBe("The thread was not found.");
  }),
);

const privateFixture = () => {
  const instanceId = ProviderInstanceId.make("synthetic-private-reader");
  const modelSelection = { instanceId, model: "tinfoil/kimi-k3" };
  const settings = {
    ...DEFAULT_SERVER_SETTINGS,
    providerInstances: {
      [instanceId]: {
        driver: ProviderDriverKind.make("opencode"),
        enabled: true,
        config: { privateInference: "tinfoil", serverUrl: "" },
      },
    },
  };
  const route = {
    modelSelection,
    providerConfigHash: privateProviderConfigHash(settings, modelSelection),
  };
  const caller = {
    ...liveThreadShell(ThreadId.make("synthetic-private-caller")),
    providerInstanceId: instanceId,
    modelSelection,
  };
  const target = { ...liveThreadShell(bareId), privateModelRoute: route };
  return { settings: { ...settings, privateModelRoute: route }, caller, target };
};

it.effect("blocks generic private thread reads before loading their queued content", () => {
  const { settings, target } = privateFixture();
  let projectionReads = 0;
  return Effect.gen(function* () {
    const error = yield* readThread(bareId, ["messages", "runs"]).pipe(Effect.flip);
    expect(error.code).toBe("capability_denied");
    expect(projectionReads).toBe(0);
  }).pipe(
    Effect.provideService(McpInvocationContext.McpInvocationContext, client),
    Effect.provide([
      ServerSettings.layerTest(settings),
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: () => Effect.succeed(target),
        getProjectThreadRecords: () =>
          Effect.sync(() => {
            projectionReads += 1;
            return idleThreadProjection(target);
          }),
      }),
    ]),
  );
});

it.effect("keeps an unlocked Tinfoil caller from importing private context", () => {
  const { settings, caller, target } = privateFixture();
  return Effect.gen(function* () {
    const error = yield* readThread(bareId, ["messages"]).pipe(Effect.flip);
    expect(error.code).toBe("capability_denied");
  }).pipe(
    Effect.provideService(McpInvocationContext.McpInvocationContext, {
      ...client,
      client: undefined,
      thread: {
        threadId: caller.id,
        providerInstanceId: caller.providerInstanceId,
        providerSessionId: "synthetic-reader-session",
      },
    }),
    Effect.provide([
      ServerSettings.layerTest(settings),
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: (id) => Effect.succeed(id === caller.id ? caller : target),
        getProjectThreadRecords: () => Effect.succeed(idleThreadProjection(target)),
      }),
    ]),
  );
});

it.effect("allows a locked approved coordinator to read private context", () => {
  const { settings, caller, target } = privateFixture();
  return Effect.gen(function* () {
    const { projection } = yield* readThread(bareId, ["messages"]);
    expect(projection.thread.id).toBe(bareId);
  }).pipe(
    Effect.provideService(McpInvocationContext.McpInvocationContext, {
      ...client,
      client: undefined,
      thread: {
        threadId: caller.id,
        providerInstanceId: caller.providerInstanceId,
        providerSessionId: "synthetic-reader-session",
      },
    }),
    Effect.provide([
      ServerSettings.layerTest(settings),
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: (id) =>
          Effect.succeed(
            id === caller.id ? { ...caller, privateModelRoute: target.privateModelRoute } : target,
          ),
        getProjectThreadRecords: () => Effect.succeed(idleThreadProjection(target)),
      }),
    ]),
  );
});
