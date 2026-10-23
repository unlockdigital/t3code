import { expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  type OrchestrationV2AppThread,
  type PrivateHelperProposalInput,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as PrivateHelpers from "./PrivateHelpers.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import { privateProviderConfigHash } from "./modelRoutingPolicy.ts";

const privateId = ProviderInstanceId.make("synthetic-private");
const helperId = ProviderInstanceId.make("synthetic-subscription");
const threadId = ThreadId.make("synthetic-private-thread");
const projectId = ProjectId.make("synthetic-project");
const selection = { instanceId: privateId, model: "tinfoil/kimi-k3" };
const helperSelection = { instanceId: helperId, model: "opencode-go/synthetic-coder" };
const proposal: PrivateHelperProposalInput = {
  threadId,
  modelSelection: helperSelection,
  task: {
    objective: "Implement a pure addition function using invented inputs.",
    files: [
      { path: "interface.ts", content: "export type Add = (a: number, b: number) => number;" },
    ],
    outputPaths: ["add.ts"],
  },
};
const encodeReply = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      files: Schema.Array(Schema.Struct({ path: Schema.String, content: Schema.String })),
    }),
  ),
);

const fixture = Effect.fn("PrivateHelpers.test.fixture")(function* (
  options: {
    standard?: boolean;
    disabled?: boolean;
    outputPath?: string;
    gate?: Deferred.Deferred<void>;
  } = {},
) {
  const started = yield* Deferred.make<void>();
  const now = yield* DateTime.now;
  const settings = {
    ...DEFAULT_SERVER_SETTINGS,
    providerInstances: {
      [privateId]: {
        driver: ProviderDriverKind.make("opencode"),
        enabled: true,
        config: { privateInference: "tinfoil", serverUrl: "" },
      },
      [helperId]: {
        driver: ProviderDriverKind.make("opencode"),
        enabled: true,
        config: { privateInference: "off", serverUrl: "" },
      },
    },
  };
  const route = {
    modelSelection: selection,
    providerConfigHash: privateProviderConfigHash(settings, selection),
  };
  let thread: OrchestrationV2AppThread = {
    id: threadId,
    projectId,
    title: "invented-sensitive-parent-canary",
    providerInstanceId: privateId,
    modelSelection: selection,
    createdBy: "user",
    creationSource: "web",
    runtimeMode: "auto",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
    ...(options.standard ? {} : { privateModelRoute: route }),
    ...(options.disabled ? { privateHelpers: "disabled" as const } : {}),
  };
  const calls: { prompt: string; modelSelection: typeof helperSelection }[] = [];
  const provider = {
    enabled: true,
    scopedText: (input: { prompt: string; modelSelection: typeof helperSelection }) =>
      Effect.gen(function* () {
        calls.push(input);
        yield* Deferred.succeed(started, undefined);
        if (options.gate !== undefined) yield* Deferred.await(options.gate);
        return {
          text: encodeReply({
            files: [
              {
                path: options.outputPath ?? "add.ts",
                content: "export const add = (a: number, b: number) => a + b;",
              },
            ],
          }),
        };
      }),
  } as unknown as ProviderInstance;
  const layer = Layer.effect(PrivateHelpers.PrivateHelpers, PrivateHelpers.make).pipe(
    Layer.provide(
      Layer.mock(ProjectionStore.ProjectionStoreV2)({ getThread: () => Effect.succeed(thread) }),
    ),
    Layer.provide(
      Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
        getInstance: (id) => Effect.succeed(id === helperId ? provider : undefined),
      }),
    ),
    Layer.provideMerge(ServerSettings.layerTest({ ...settings, privateModelRoute: route })),
  );
  return {
    layer,
    calls,
    started,
    thread,
    setThread: (next: OrchestrationV2AppThread) => {
      thread = next;
    },
  };
});

it.effect("keeps the review cache bounded when an evicted in-flight result finishes", () =>
  Effect.gen(function* () {
    const gate = yield* Deferred.make<void>();
    const f = yield* fixture({ gate });
    yield* Effect.gen(function* () {
      const helpers = yield* PrivateHelpers.PrivateHelpers;
      const first = yield* helpers.propose(proposal);
      const running = yield* Effect.forkChild(
        helpers.decide({ threadId, packetId: first.id, digest: first.digest, decision: "approve" }),
      );
      yield* Deferred.await(f.started);
      for (let index = 0; index < 32; index++) yield* helpers.propose(proposal);
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(running);
      const state = yield* helpers.state(threadId);
      expect(state.packets).toHaveLength(32);
      expect(state.packets.some((packet) => packet.id === first.id)).toBe(false);
    }).pipe(Effect.provide(f.layer));
  }),
);

it.effect("allows withdrawing a pending packet after disabling helpers", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* Effect.gen(function* () {
      const helpers = yield* PrivateHelpers.PrivateHelpers;
      const packet = yield* helpers.propose(proposal);
      f.setThread({ ...f.thread, privateHelpers: "disabled" });
      expect(
        yield* Effect.flip(
          helpers.decide({
            threadId,
            packetId: packet.id,
            digest: packet.digest,
            decision: "approve",
          }),
        ),
      ).toMatchObject({ reason: "helpers-disabled" });
      expect(
        yield* helpers.decide({
          threadId,
          packetId: packet.id,
          digest: packet.digest,
          decision: "block",
        }),
      ).toMatchObject({ status: "blocked" });
      expect(f.calls).toHaveLength(0);
    }).pipe(Effect.provide(f.layer));
  }),
);

it.effect(
  "requires human packet approval, sends only the exact packet once, and returns a quarantined artifact",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* Effect.gen(function* () {
        const helpers = yield* PrivateHelpers.PrivateHelpers;
        const packet = yield* helpers.propose(proposal);
        expect(f.calls).toHaveLength(0);
        expect(packet.status).toBe("awaiting-review");
        expect(packet.prompt).not.toContain("invented-sensitive-parent-canary");
        expect(packet.prompt).not.toContain("TINFOIL_API_KEY");
        expect(
          yield* Effect.flip(
            helpers.decide({ threadId, packetId: packet.id, digest: "wrong", decision: "approve" }),
          ),
        ).toMatchObject({ reason: "changed" });
        const decisions = yield* Effect.all(
          [
            helpers.decide({
              threadId,
              packetId: packet.id,
              digest: packet.digest,
              decision: "approve",
            }),
            helpers.decide({
              threadId,
              packetId: packet.id,
              digest: packet.digest,
              decision: "approve",
            }),
          ].map((effect) => Effect.result(effect)),
          { concurrency: "unbounded" },
        );
        expect(decisions.filter((result) => result._tag === "Success")).toHaveLength(1);
        expect(f.calls).toEqual([{ prompt: packet.prompt, modelSelection: helperSelection }]);
        const state = yield* helpers.state(threadId);
        expect(state.packets[0]).toMatchObject({ status: "completed" });
        expect(state.packets[0]?.artifact).toContain("export const add");
      }).pipe(Effect.provide(f.layer));
    }),
);

it.effect("keeps disabled and Standard workflows from dispatching helpers", () =>
  Effect.gen(function* () {
    for (const options of [{ standard: true }, { disabled: true }]) {
      const f = yield* fixture(options);
      yield* Effect.gen(function* () {
        const helpers = yield* PrivateHelpers.PrivateHelpers;
        expect(yield* Effect.flip(helpers.propose(proposal))).toMatchObject({
          reason: options.standard ? "private-required" : "helpers-disabled",
        });
        expect(f.calls).toHaveLength(0);
      }).pipe(Effect.provide(f.layer));
    }
  }),
);

it.effect("restricts coordinator access to the private thread's approved provider", () =>
  Effect.gen(function* () {
    for (const standard of [false, true]) {
      const f = yield* fixture({ standard });
      yield* Effect.gen(function* () {
        const helpers = yield* PrivateHelpers.PrivateHelpers;
        expect(yield* Effect.flip(helpers.checkCoordinator(threadId, helperId))).toMatchObject({
          reason: "private-required",
        });
        if (standard)
          expect(yield* Effect.flip(helpers.checkCoordinator(threadId, privateId))).toMatchObject({
            reason: "private-required",
          });
        else yield* helpers.checkCoordinator(threadId, privateId);
        expect(f.calls).toHaveLength(0);
      }).pipe(Effect.provide(f.layer));
    }
  }),
);

it.effect("blocks unsafe paths and credential-shaped packet content before any disclosure", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* Effect.gen(function* () {
      const helpers = yield* PrivateHelpers.PrivateHelpers;
      for (const task of [
        { ...proposal.task, outputPaths: ["../outside.ts"] },
        {
          ...proposal.task,
          files: [{ path: "source.ts", content: `sk-${"SYNTHETIC".repeat(8)}` }],
        },
        { ...proposal.task, files: [{ path: "source.ts", content: "person@example.invalid" }] },
      ])
        expect(yield* Effect.flip(helpers.propose({ ...proposal, task }))).toMatchObject({
          reason: "invalid-packet",
        });
      expect(f.calls).toHaveLength(0);
    }).pipe(Effect.provide(f.layer));
  }),
);

it.effect("expires reviews and rejects connection changes before sending", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* Effect.gen(function* () {
      const helpers = yield* PrivateHelpers.PrivateHelpers;
      const packet = yield* helpers.propose(proposal);
      const settings = yield* ServerSettings.ServerSettingsService;
      yield* settings.updateSettings({
        providerInstances: {
          [helperId]: {
            driver: ProviderDriverKind.make("opencode"),
            enabled: true,
            config: { binaryPath: "changed-synthetic-launcher" },
          },
        },
      });
      expect(
        yield* Effect.flip(
          helpers.decide({
            threadId,
            packetId: packet.id,
            digest: packet.digest,
            decision: "approve",
          }),
        ),
      ).toMatchObject({ reason: "changed" });
      yield* TestClock.adjust("16 minutes");
      expect(
        yield* Effect.flip(
          helpers.decide({
            threadId,
            packetId: packet.id,
            digest: packet.digest,
            decision: "approve",
          }),
        ),
      ).toMatchObject({ reason: "expired" });
      expect(f.calls).toHaveLength(0);
    }).pipe(Effect.provide(f.layer));
  }),
);

it.effect("rejects artifacts outside the reviewed output scope", () =>
  Effect.gen(function* () {
    const f = yield* fixture({ outputPath: "outside.ts" });
    yield* Effect.gen(function* () {
      const helpers = yield* PrivateHelpers.PrivateHelpers;
      const packet = yield* helpers.propose(proposal);
      expect(
        yield* helpers.decide({
          threadId,
          packetId: packet.id,
          digest: packet.digest,
          decision: "approve",
        }),
      ).toMatchObject({ status: "failed" });
      expect((yield* helpers.state(threadId)).packets[0]?.artifact).toBeUndefined();
    }).pipe(Effect.provide(f.layer));
  }),
);
