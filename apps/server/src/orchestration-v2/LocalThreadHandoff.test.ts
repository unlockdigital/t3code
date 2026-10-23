// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ThreadId, OrchestrationV2ThreadTranscript } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import * as LocalThreadHandoff from "./LocalThreadHandoff.ts";

const threadId = ThreadId.make("shared");
const attachmentId = "shared-11111111-1111-4111-8111-111111111111-txt";
const imageId = "shared-22222222-2222-4222-8222-222222222222";
const otherId = "other-33333333-3333-4333-8333-333333333333-txt";
const decodeTranscript = Schema.decodeUnknownSync(OrchestrationV2ThreadTranscript);
const transcript = decodeTranscript({
  threadId,
  title: "Shared context",
  updatedAt: DateTime.makeUnsafe("2026-10-23T12:00:00.000Z"),
  items: [
    {
      position: 0,
      visibility: "inherited",
      sourceThreadId: threadId,
      sourceItemId: "item",
      item: {
        id: "item",
        threadId,
        runId: null,
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 0,
        status: "completed",
        title: null,
        startedAt: null,
        completedAt: null,
        updatedAt: DateTime.makeUnsafe("2026-10-23T12:00:00.000Z"),
        type: "assistant_message",
        messageId: "message",
        streaming: false,
        text: "Please review these files.",
        attachments: [
          {
            type: "file",
            id: attachmentId,
            name: "../../instructions.txt",
            mimeType: "text/plain",
            sizeBytes: 6,
          },
          { type: "image", id: imageId, name: "image.png", mimeType: "image/png", sizeBytes: 5 },
        ],
      },
    },
  ],
});

const layerTest = LocalThreadHandoff.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-local-handoff-" })),
  Layer.provide(
    Layer.mock(ThreadManagementService.ThreadManagementService)({
      getThreadTranscript: (id) =>
        id === threadId ? Effect.succeed(transcript) : Effect.die("Unexpected thread read"),
    }),
  ),
  Layer.provide(
    Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("this-machine")),
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

it.effect(
  "exports only the selected thread's files with private permissions and supports deletion",
  () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      NodeFS.writeFileSync(NodePath.join(config.attachmentsDir, `${attachmentId}.txt`), "report");
      NodeFS.writeFileSync(NodePath.join(config.attachmentsDir, `${imageId}.png`), "image");
      NodeFS.writeFileSync(
        NodePath.join(config.attachmentsDir, `${otherId}.txt`),
        "unrelated secret",
      );
      const service = yield* LocalThreadHandoff.LocalThreadHandoff;
      const result = yield* service.create(threadId);
      expect(result.attachmentCount).toBe(2);
      expect(result.unavailableAttachmentCount).toBe(0);
      expect(result.handoff).toContain(result.transcriptPath);
      expect(result.handoff).not.toContain("t3 thread export");
      expect(result.markdown).toContain("Please review these files.");
      const folder = NodePath.dirname(result.transcriptPath);
      expect(NodeFS.readFileSync(result.transcriptPath, "utf8")).toBe(result.markdown);
      expect(NodeFS.readdirSync(NodePath.join(folder, "attachments"))).toEqual(["1.txt", "2.png"]);
      expect(NodeFS.readFileSync(NodePath.join(folder, "attachments/1.txt"), "utf8")).toBe(
        "report",
      );
      expect(result.markdown).not.toContain(otherId);
      expect(result.markdown).not.toContain("unrelated secret");
      if ((yield* HostProcess.Platform) !== "win32") {
        expect(NodeFS.statSync(folder).mode & 0o777).toBe(0o700);
        expect(NodeFS.statSync(result.transcriptPath).mode & 0o777).toBe(0o600);
        expect(NodeFS.statSync(NodePath.join(folder, "attachments/1.txt")).mode & 0o777).toBe(
          0o600,
        );
      }
      yield* service.remove(result.exportId);
      yield* service.remove(result.exportId);
      expect(NodeFS.existsSync(folder)).toBe(false);
      expect(
        NodeFS.readFileSync(NodePath.join(config.attachmentsDir, `${attachmentId}.txt`), "utf8"),
      ).toBe("report");
    }).pipe(Effect.provide(layerTest)),
);

it.effect("lists missing attachments and refuses symlinked files", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const secret = NodePath.join(config.stateDir, "private-settings.json");
    NodeFS.writeFileSync(secret, "credentials stay here");
    NodeFS.symlinkSync(secret, NodePath.join(config.attachmentsDir, `${attachmentId}.txt`));
    const service = yield* LocalThreadHandoff.LocalThreadHandoff;
    const result = yield* service.create(threadId);
    expect(result.attachmentCount).toBe(0);
    expect(result.unavailableAttachmentCount).toBe(2);
    expect(result.markdown).toContain("could not be opened safely");
    expect(result.markdown).toContain("Source attachment is missing");
    expect(
      NodeFS.readdirSync(NodePath.join(NodePath.dirname(result.transcriptPath), "attachments")),
    ).toEqual([]);
    expect(result.markdown).not.toContain("credentials stay here");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("rejects handoff-root symlinks and deletion traversal", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const outside = NodePath.join(config.stateDir, "other");
    NodeFS.mkdirSync(outside);
    NodeFS.writeFileSync(NodePath.join(outside, "keep.txt"), "keep");
    NodeFS.symlinkSync(outside, NodePath.join(config.stateDir, "handoffs"));
    const service = yield* LocalThreadHandoff.LocalThreadHandoff;
    expect(yield* service.create(threadId).pipe(Effect.flip)).toMatchObject({ stage: "unsafe" });
    expect(yield* service.remove("../other").pipe(Effect.flip)).toMatchObject({ stage: "unsafe" });
    expect(NodeFS.readFileSync(NodePath.join(outside, "keep.txt"), "utf8")).toBe("keep");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("excludes hard-linked and oversized files while retaining the transcript", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const secret = NodePath.join(config.stateDir, "private.txt");
    NodeFS.writeFileSync(secret, "private bytes");
    NodeFS.linkSync(secret, NodePath.join(config.attachmentsDir, `${attachmentId}.txt`));
    const image = NodePath.join(config.attachmentsDir, `${imageId}.png`);
    NodeFS.writeFileSync(image, "");
    NodeFS.truncateSync(image, 40 * 1024 * 1024);
    const service = yield* LocalThreadHandoff.LocalThreadHandoff;
    const result = yield* service.create(threadId);
    expect(result.attachmentCount).toBe(0);
    expect(result.unavailableAttachmentCount).toBe(2);
    expect(result.markdown).toContain("not a private regular file");
    expect(result.markdown).toContain("size limit");
    expect(result.markdown).not.toContain("private bytes");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("bounds retained snapshots and leaves previous exports intact", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const root = NodePath.join(config.stateDir, "handoffs");
    NodeFS.mkdirSync(root, { mode: 0o700 });
    for (let i = 0; i < 20; i++)
      NodeFS.mkdirSync(NodePath.join(root, `handoff-${String(i).padStart(6, "0")}`));
    const service = yield* LocalThreadHandoff.LocalThreadHandoff;
    expect(yield* service.create(threadId).pipe(Effect.flip)).toMatchObject({ stage: "limit" });
    expect(NodeFS.readdirSync(root)).toHaveLength(20);
  }).pipe(Effect.provide(layerTest)),
);
