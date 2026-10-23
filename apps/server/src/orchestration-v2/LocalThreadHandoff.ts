// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as Schema from "effect/Schema";
import {
  LocalThreadHandoffError,
  type LocalThreadHandoff as Snapshot,
  type ThreadId,
} from "@t3tools/contracts";
import {
  formatConversationMarkdown,
  formatThreadHandoff,
  threadTranscriptContext,
  type ConversationContext,
} from "@t3tools/shared/threadHandoff";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { parseAttachmentUuid, resolveAttachmentPathById } from "../attachmentStore.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

const MAX_EXPORT_BYTES = 32 * 1024 * 1024;
const MAX_EXPORTS = 20;
const MAX_ATTACHMENTS = 256;
const EXPORT_ID = /^handoff-[a-zA-Z0-9_-]{6,64}$/;
const isLocalThreadHandoffError = Schema.is(LocalThreadHandoffError);

export class LocalThreadHandoff extends Context.Service<
  LocalThreadHandoff,
  {
    readonly create: (threadId: ThreadId) => Effect.Effect<Snapshot, LocalThreadHandoffError>;
    readonly remove: (exportId: string) => Effect.Effect<void, LocalThreadHandoffError>;
  }
>()("t3/orchestration-v2/LocalThreadHandoff") {}

async function privateDirectory(path: string) {
  await NodeFSP.mkdir(path, { mode: 0o700 });
}

async function ensurePrivateRoot(stateDir: string) {
  const root = NodePath.join(await NodeFSP.realpath(stateDir), "handoffs");
  await privateDirectory(root).catch((error: unknown) => {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  });
  const info = await NodeFSP.lstat(root);
  const uid = NodeOS.userInfo().uid;
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (uid >= 0 && (info.uid !== uid || (info.mode & 0o077) !== 0))
  )
    throw new LocalThreadHandoffError({ stage: "unsafe", cause: null });
  return root;
}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const environment = yield* ServerEnvironment.ServerEnvironmentIdentity;
  const lock = yield* Semaphore.make(1);
  const create = Effect.fn("LocalThreadHandoff.create")(function* (threadId: ThreadId) {
    const transcript = yield* threads.getThreadTranscript(threadId).pipe(
      Effect.provideService(ServerEnvironment.ServerEnvironmentIdentity, environment),
      Effect.mapError((cause) => new LocalThreadHandoffError({ stage: "read", cause })),
    );
    const context = threadTranscriptContext(yield* environment.getEnvironmentId, transcript);
    return yield* Effect.tryPromise({
      try: async () => {
        const root = await ensurePrivateRoot(config.stateDir);
        if ((await NodeFSP.readdir(root)).length >= MAX_EXPORTS)
          throw new LocalThreadHandoffError({ stage: "limit", cause: null });
        const allAttachments = context.entries.flatMap((entry) => entry.attachments ?? []);
        if (allAttachments.length > MAX_ATTACHMENTS)
          throw new LocalThreadHandoffError({ stage: "limit", cause: null });
        const directory = await NodeFSP.mkdtemp(NodePath.join(root, "handoff-"));
        await NodeFSP.chmod(directory, 0o700);
        try {
          const files = NodePath.join(directory, "attachments");
          await privateDirectory(files);
          let bytes = Buffer.byteLength(formatConversationMarkdown(context), "utf8");
          if (bytes > MAX_EXPORT_BYTES)
            throw new LocalThreadHandoffError({ stage: "limit", cause: null });
          let attachmentCount = 0;
          let unavailableAttachmentCount = 0;
          const copied = new Map<string, { path?: string; unavailableReason?: string }>();
          const entries: ConversationContext["entries"][number][] = [];
          for (const entry of context.entries) {
            const attachments = [];
            for (const attachment of entry.attachments ?? []) {
              const id = attachment.id;
              let result = id ? copied.get(id) : undefined;
              if (!result) {
                result = {};
                if (!id || !parseAttachmentUuid(id)) {
                  result = { unavailableReason: "Attachment reference could not be verified." };
                } else {
                  const source = resolveAttachmentPathById({
                    attachmentsDir: config.attachmentsDir,
                    attachmentId: id,
                  });
                  if (!source) result = { unavailableReason: "Source attachment is missing." };
                  else {
                    // O_NOFOLLOW and fstat bind the bytes to a regular stored attachment,
                    // including when an on-disk file is replaced between lookup and open.
                    const storedRoot = await NodeFSP.lstat(config.attachmentsDir);
                    const sourceInfo = await NodeFSP.lstat(source);
                    const handle =
                      !storedRoot.isDirectory() ||
                      storedRoot.isSymbolicLink() ||
                      !sourceInfo.isFile() ||
                      sourceInfo.isSymbolicLink()
                        ? null
                        : await NodeFSP.open(
                            source,
                            NodeFS.constants.O_RDONLY |
                              NodeFS.constants.O_NOFOLLOW |
                              NodeFS.constants.O_NONBLOCK,
                          ).catch(() => null);
                    if (!handle)
                      result = {
                        unavailableReason: "Source attachment could not be opened safely.",
                      };
                    else {
                      try {
                        const info = await handle.stat();
                        if (!info.isFile() || info.nlink !== 1)
                          result = {
                            unavailableReason: "Source attachment is not a private regular file.",
                          };
                        else if (info.size > MAX_EXPORT_BYTES - bytes)
                          result = {
                            unavailableReason: "Attachment exceeds this handoff's size limit.",
                          };
                        else {
                          const data = Buffer.alloc(info.size);
                          let offset = 0;
                          while (offset < data.length) {
                            const read = await handle.read(
                              data,
                              offset,
                              data.length - offset,
                              offset,
                            );
                            if (read.bytesRead === 0) break;
                            offset += read.bytesRead;
                          }
                          const after = await handle.stat();
                          if (
                            offset !== data.length ||
                            after.size !== info.size ||
                            after.mtimeMs !== info.mtimeMs ||
                            after.ctimeMs !== info.ctimeMs
                          )
                            result = {
                              unavailableReason: "Source attachment changed during export.",
                            };
                          else {
                            bytes += data.length;
                            const extension = NodePath.extname(source);
                            const path = NodePath.join(files, `${copied.size + 1}${extension}`);
                            await NodeFSP.writeFile(path, data, { mode: 0o600, flag: "wx" });
                            result = { path };
                            attachmentCount++;
                          }
                        }
                      } finally {
                        await handle.close();
                      }
                    }
                  }
                }
                if (result.unavailableReason) unavailableAttachmentCount++;
                if (id) copied.set(id, result);
              }
              attachments.push({ ...attachment, ...result });
            }
            entries.push({ ...entry, attachments });
          }
          const markdown = formatConversationMarkdown({ ...context, entries });
          if (
            bytes +
              Buffer.byteLength(markdown, "utf8") -
              Buffer.byteLength(formatConversationMarkdown(context), "utf8") >
            MAX_EXPORT_BYTES
          )
            throw new LocalThreadHandoffError({ stage: "limit", cause: null });
          const transcriptPath = NodePath.join(directory, "conversation.md");
          await NodeFSP.writeFile(transcriptPath, markdown, { mode: 0o600, flag: "wx" });
          return {
            exportId: NodePath.basename(directory),
            transcriptPath,
            markdown,
            attachmentCount,
            unavailableAttachmentCount,
            handoff: formatThreadHandoff({
              threadId,
              title: context.title,
              environmentId: context.environmentId!,
              localSnapshot: { transcriptPath, attachmentCount, unavailableAttachmentCount },
            }),
          };
        } catch (error) {
          await NodeFSP.rm(directory, { recursive: true, force: true });
          throw error;
        }
      },
      catch: (cause) =>
        isLocalThreadHandoffError(cause)
          ? cause
          : new LocalThreadHandoffError({ stage: "write", cause }),
    });
  }, lock.withPermits(1));
  const remove = Effect.fn("LocalThreadHandoff.remove")(function* (exportId: string) {
    return yield* Effect.tryPromise({
      try: async () => {
        if (!EXPORT_ID.test(exportId))
          throw new LocalThreadHandoffError({ stage: "unsafe", cause: null });
        const root = await ensurePrivateRoot(config.stateDir);
        const path = NodePath.join(root, exportId);
        const info = await NodeFSP.lstat(path).catch((error: unknown) => {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
          throw error;
        });
        if (!info) return;
        if (!info.isDirectory() || info.isSymbolicLink())
          throw new LocalThreadHandoffError({ stage: "unsafe", cause: null });
        await NodeFSP.rm(path, { recursive: true });
      },
      catch: (cause) =>
        isLocalThreadHandoffError(cause)
          ? cause
          : new LocalThreadHandoffError({ stage: "write", cause }),
    });
  }, lock.withPermits(1));
  return LocalThreadHandoff.of({ create, remove });
});

export const layer = Layer.effect(LocalThreadHandoff, make);
