import {
  PrivateHelperError,
  PrivateHelperPacket as PrivateHelperPacketSchema,
  PrivateHelperTask as PrivateHelperTaskSchema,
  type PrivateHelperDecisionInput,
  type PrivateHelperPacket,
  type PrivateHelperProposalInput,
  type PrivateHelperTask,
  type ThreadId,
  type ProviderInstanceId,
  resolveProjectProviderInstanceEnabled,
} from "@t3tools/contracts";
import { providerConfigurationHash } from "@t3tools/shared/providerConfigurationHash";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import { assertPrivateModelSelection } from "./modelRoutingPolicy.ts";

const MAX_PACKET = 24_000;
const MAX_PACKETS = 32;
const EXPIRES_MS = 15 * 60_000;
const Artifact = Schema.Struct({
  files: Schema.Array(Schema.Struct({ path: Schema.String, content: Schema.String })).check(
    Schema.isMaxLength(8),
  ),
});
const decodeArtifact = Schema.decodeUnknownEffect(Schema.fromJsonString(Artifact));
const clonePacket = Schema.decodeUnknownSync(Schema.fromJsonString(PrivateHelperPacketSchema));
const encodePacket = Schema.encodeSync(Schema.fromJsonString(PrivateHelperPacketSchema));
const encodeTask = Schema.encodeSync(Schema.fromJsonString(PrivateHelperTaskSchema));
const encodeArtifact = Schema.encodeSync(Schema.fromJsonString(Artifact));
const safePath = (value: string) =>
  value.length <= 180 &&
  /^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(value) &&
  value.split("/").every((part) => part !== ".." && part !== "." && part !== "") &&
  !/(?:^|\/)(?:\.env|auth|credentials|secrets)(?:\.|\/|$)/i.test(value);
const sensitivePattern =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk-|tk_|admin_)[A-Za-z0-9_-]{20,}|\bBearer\s+[A-Za-z0-9._-]{20,}|(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/i;

function buildPrivateHelperPrompt(task: PrivateHelperTask): string {
  return [
    "Implement the self-contained task using only the supplied synthetic interfaces and fixtures.",
    'Return one JSON object: {"files":[{"path":"relative/output.ts","content":"..."}]}. Use only outputPaths. The receiver reviews the artifact before applying or executing it.',
    encodeTask(task),
  ].join("\n\n");
}

interface StoredPacket {
  readonly threadId: ThreadId;
  readonly packet: PrivateHelperPacket;
  readonly connectionHash: string;
  readonly expiresAt: number;
}

export class PrivateHelpers extends Context.Service<
  PrivateHelpers,
  {
    readonly checkCoordinator: (
      threadId: ThreadId,
      instanceId: ProviderInstanceId,
    ) => Effect.Effect<void, PrivateHelperError>;
    readonly propose: (
      input: PrivateHelperProposalInput,
    ) => Effect.Effect<PrivateHelperPacket, PrivateHelperError>;
    readonly state: (
      threadId: ThreadId,
    ) => Effect.Effect<{ packets: readonly PrivateHelperPacket[] }, PrivateHelperError>;
    readonly decide: (
      input: PrivateHelperDecisionInput,
    ) => Effect.Effect<PrivateHelperPacket, PrivateHelperError>;
  }
>()("t3/privacy/PrivateHelpers") {}

export const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const threads = yield* ProjectionStore.ProjectionStoreV2;
  const providers = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  // Review grants are memory-only: a restart expires every outstanding disclosure approval.
  const packets = yield* Ref.make(new Map<string, StoredPacket>());
  let ordinal = 0;
  const context = Effect.fn("PrivateHelpers.context")(function* (threadId: ThreadId) {
    const thread = yield* threads
      .getThread(threadId)
      .pipe(Effect.mapError(() => new PrivateHelperError({ reason: "private-required" })));
    if (thread.privateModelRoute === undefined)
      return yield* new PrivateHelperError({ reason: "private-required" });
    const current = yield* settings.getRoutingSettings.pipe(
      Effect.mapError(() => new PrivateHelperError({ reason: "changed" })),
    );
    yield* assertPrivateModelSelection(current, thread, thread.modelSelection).pipe(
      Effect.mapError(() => new PrivateHelperError({ reason: "changed" })),
    );
    return { thread, current };
  });
  const destination = Effect.fn("PrivateHelpers.destination")(function* (
    input: PrivateHelperProposalInput,
  ) {
    const { thread, current } = yield* context(input.threadId);
    if (thread.privateHelpers === "disabled")
      return yield* new PrivateHelperError({ reason: "helpers-disabled" });
    const config = current.providerInstances[input.modelSelection.instanceId];
    const provider = yield* providers.getInstance(input.modelSelection.instanceId);
    if (
      !provider?.enabled ||
      provider.scopedText === undefined ||
      config?.driver !== "opencode" ||
      !resolveProjectProviderInstanceEnabled(
        current,
        thread.projectId,
        input.modelSelection.instanceId,
      ) ||
      input.modelSelection.model.startsWith("tinfoil/")
    )
      return yield* new PrivateHelperError({ reason: "unavailable" });
    return { generate: provider.scopedText, connectionHash: providerConfigurationHash(config) };
  });
  return PrivateHelpers.of({
    checkCoordinator: Effect.fn("PrivateHelpers.checkCoordinator")(
      function* (threadId, instanceId) {
        const { thread } = yield* context(threadId);
        if (thread.privateModelRoute?.modelSelection.instanceId !== instanceId)
          return yield* new PrivateHelperError({ reason: "private-required" });
      },
    ),
    propose: Effect.fn("PrivateHelpers.propose")(function* (input) {
      const prompt = buildPrivateHelperPrompt(input.task);
      if (
        prompt.length > MAX_PACKET ||
        sensitivePattern.test(prompt) ||
        !input.task.outputPaths.every(safePath) ||
        !input.task.files.every((file) => safePath(file.path))
      )
        return yield* new PrivateHelperError({ reason: "invalid-packet" });
      const target = yield* destination(input);
      const now = yield* DateTime.now;
      const epoch = DateTime.toEpochMillis(now);
      const digest = providerConfigurationHash({ ...input, connectionHash: target.connectionHash });
      const packet: PrivateHelperPacket = {
        id: `helper-${epoch}-${++ordinal}`,
        digest,
        modelSelection: input.modelSelection,
        task: input.task,
        prompt,
        status: "awaiting-review",
        createdAt: DateTime.formatIso(now),
      };
      yield* Ref.update(packets, (current) => {
        const next = new Map([...current].filter(([, entry]) => entry.expiresAt > epoch));
        while (next.size >= MAX_PACKETS) next.delete(next.keys().next().value!);
        next.set(packet.id, {
          threadId: input.threadId,
          packet,
          connectionHash: target.connectionHash,
          expiresAt: epoch + EXPIRES_MS,
        });
        return next;
      });
      return clonePacket(encodePacket(packet));
    }),
    state: Effect.fn("PrivateHelpers.state")(function* (threadId) {
      yield* context(threadId);
      const now = yield* DateTime.now;
      return {
        packets: [...(yield* Ref.get(packets)).values()]
          .filter(
            (entry) => entry.threadId === threadId && entry.expiresAt > DateTime.toEpochMillis(now),
          )
          .map((entry) => clonePacket(encodePacket(entry.packet))),
      };
    }),
    decide: Effect.fn("PrivateHelpers.decide")(function* (input) {
      const stored = (yield* Ref.get(packets)).get(input.packetId);
      const now = yield* DateTime.now;
      if (
        stored === undefined ||
        stored.threadId !== input.threadId ||
        stored.expiresAt <= DateTime.toEpochMillis(now) ||
        stored.packet.status !== "awaiting-review"
      )
        return yield* new PrivateHelperError({ reason: "expired" });
      if (stored.packet.digest !== input.digest)
        return yield* new PrivateHelperError({ reason: "changed" });
      if (
        stored.packet.prompt !== buildPrivateHelperPrompt(stored.packet.task) ||
        providerConfigurationHash({
          threadId: input.threadId,
          modelSelection: stored.packet.modelSelection,
          task: stored.packet.task,
          connectionHash: stored.connectionHash,
        }) !== input.digest
      )
        return yield* new PrivateHelperError({ reason: "changed" });
      const target =
        input.decision === "block"
          ? null
          : yield* destination({
              threadId: input.threadId,
              modelSelection: stored.packet.modelSelection,
              task: stored.packet.task,
            });
      if (target !== null && target.connectionHash !== stored.connectionHash)
        return yield* new PrivateHelperError({ reason: "changed" });
      const status = input.decision === "block" ? "blocked" : "running";
      const claimed = yield* Ref.modify(packets, (current) => {
        if (current.get(input.packetId)?.packet.status !== "awaiting-review")
          return [false, current] as const;
        const next = new Map(current);
        next.set(input.packetId, { ...stored, packet: { ...stored.packet, status } });
        return [true, next] as const;
      });
      if (!claimed) return yield* new PrivateHelperError({ reason: "expired" });
      if (status === "blocked") return { ...stored.packet, status };
      if (target === null) return yield* new PrivateHelperError({ reason: "expired" });
      const result = yield* Effect.result(
        target
          .generate({ modelSelection: stored.packet.modelSelection, prompt: stored.packet.prompt })
          .pipe(
            Effect.flatMap((reply) =>
              reply.text.length <= 24_000
                ? decodeArtifact(reply.text).pipe(
                    Effect.mapError(() => new PrivateHelperError({ reason: "execution-failed" })),
                  )
                : Effect.fail(new PrivateHelperError({ reason: "execution-failed" })),
            ),
            Effect.filterOrFail(
              (artifact) =>
                artifact.files.length > 0 &&
                new Set(artifact.files.map((file) => file.path)).size === artifact.files.length &&
                artifact.files.every((file) => stored.packet.task.outputPaths.includes(file.path)),
              () => new PrivateHelperError({ reason: "execution-failed" }),
            ),
          ),
      );
      const packet: PrivateHelperPacket =
        result._tag === "Success"
          ? { ...stored.packet, status: "completed", artifact: encodeArtifact(result.success) }
          : { ...stored.packet, status: "failed" };
      yield* Ref.update(packets, (current) =>
        current.get(input.packetId)?.packet.status === "running"
          ? new Map(current).set(input.packetId, { ...stored, packet })
          : current,
      );
      return clonePacket(encodePacket(packet));
    }),
  });
});

export const layer = Layer.effect(PrivateHelpers, make).pipe(Layer.provide(ProjectionStore.layer));
