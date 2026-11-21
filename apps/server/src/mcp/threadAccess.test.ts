import { expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProviderDriverKind,
  type OrchestrationV2ThreadShell,
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
import { assertTargetWithinLimits, readThread } from "./threadAccess.ts";

const bareId = ThreadId.make("5d0b4a3e-8c1f-4a52-9d37-2f6c7e1b9a04");
const claudeCode: McpInvocationContext.McpClientCaller = {
  sessionId: "thread-access",
  label: "Claude Code",
  access: "full-access",
};
const client: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment:thread-access"),
  requestNamespace: "client:thread-access",
  thread: undefined,
  client: claudeCode,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};

const linksHint =
  "Thread ids belong to one environment: for a thread on a linked one, find it with `t3_environment_links` and pass its `environmentId` to a tool that takes one.";

const readBare = (
  existing: ReadonlyArray<OrchestrationV2ThreadShell | ThreadId>,
  scope: McpInvocationContext.McpInvocationScope = client,
  threadId: ThreadId = bareId,
) => {
  const shells = existing.map((shell) =>
    typeof shell === "string" ? liveThreadShell(shell) : shell,
  );
  return readThread(threadId).pipe(
    Effect.flip,
    Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
    Effect.provide([
      ServerSettings.layerTest(),
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: (threadId) =>
          Effect.succeed(shells.find((shell) => shell.id === threadId) ?? null),
      }),
    ]),
  );
};

it.effect("points a bare uuid at the mcp: thread it belongs to", () =>
  Effect.gen(function* () {
    const error = yield* readBare([ThreadId.make(`mcp:${bareId}`)]);

    expect(error.code).toBe("thread_not_found");
    expect(error.message).toBe(
      `The thread was not found. Did you mean \`mcp:${bareId}\`? ${linksHint}`,
    );
  }),
);

it.effect("tells a caller with linked environments that the thread may be on one of them", () =>
  Effect.gen(function* () {
    const error = yield* readBare([], { ...client, linkedEnvironments: true });

    expect(error.code).toBe("thread_not_found");
    expect(error.message).toContain("t3_environment_links");
    expect(error.message).toContain("environmentId");

    const linksOff = yield* readBare([], { ...client, linkedEnvironments: false });
    expect(linksOff.message).toBe("The thread was not found.");
    const peerLink = yield* readBare([], {
      ...client,
      linkedEnvironments: true,
      client: { ...claudeCode, linked: true },
    });
    expect(peerLink.message).toBe("The thread was not found.");

    // A thread a fenced link started may not use this environment's links.
    const fencedThread = ThreadId.make("thread:started-by-fenced-link");
    const fenced = yield* readBare(
      [
        {
          ...liveThreadShell(fencedThread),
          linkOrigin: { sessionId: "peer-session", label: "Laptop", access: "auto" },
        },
      ],
      {
        ...client,
        linkedEnvironments: true,
        client: undefined,
        thread: {
          threadId: fencedThread,
          providerSessionId: "provider-session",
          providerInstanceId: ProviderInstanceId.make("codex"),
        },
      },
    );
    expect(fenced.message).toBe("The thread was not found.");
  }),
);

it.effect("points an unencoded delegated-task id at the encoded thread it belongs to", () =>
  Effect.gen(function* () {
    const commandId = `command:mcp:${bareId}:delegate-task:0e7d2c41-6b9a-4f3e-8d15-a2c4b6e8f019`;
    const encoded = ThreadId.make(`thread:delegated-task:${encodeURIComponent(commandId)}`);
    const error = yield* readBare(
      [encoded],
      client,
      ThreadId.make(`thread:delegated-task:${commandId}`),
    );

    expect(error.code).toBe("thread_not_found");
    expect(error.message).toContain(`\`${encoded}\``);
  }),
);

it.effect("identifies the target and effective caller ceiling when a thread write is refused", () =>
  Effect.gen(function* () {
    for (const [runtimeMode, interactionMode, code] of [
      ["approval-required", "default", "runtime_mode_escalation_denied"],
      ["full-access", "plan", "interaction_mode_escalation_denied"],
      ["approval-required", "plan", "runtime_mode_escalation_denied"],
    ] as const) {
      const target = liveThreadShell(bareId, { runtimeMode: "full-access" });
      const error = yield* assertTargetWithinLimits({ runtimeMode, interactionMode }, target).pipe(
        Effect.flip,
      );

      expect(error.code).toBe(code);
      expect(error.message).toContain(bareId);
      expect(error.message).toContain("full-access/default");
      expect(error.message).toContain(`${runtimeMode}/${interactionMode}`);
      expect(error.message).not.toMatch(/child|parent mode/i);
    }
  }),
);

it.effect("keeps the plain message for an id that matches nothing", () =>
  Effect.gen(function* () {
    const error = yield* readBare([], { ...client, linkedEnvironments: false });

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
