import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import type { ConversationContext } from "@t3tools/shared/threadHandoff";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";

export class NativeSessionContextError extends Schema.TaggedError<NativeSessionContextError>()(
  "NativeSessionContextError",
  {
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override readonly [Runtime.errorReported] = false;
  override get message() {
    return this.detail;
  }
}

export class NativeSessionContext extends Context.Service<
  NativeSessionContext,
  {
    readonly read: (input: {
      readonly provider: "codex" | "claude";
      readonly reference: string;
      readonly codexHome?: string;
    }) => Effect.Effect<ConversationContext, NativeSessionContextError>;
  }
>()("t3/provider/NativeSessionContext") {}

const object = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((value: unknown) => {
      const block = object(value);
      return block &&
        ["text", "input_text", "output_text"].includes(String(block.type)) &&
        typeof block.text === "string"
        ? [block.text]
        : [];
    })
    .join("\n");
}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const environment = yield* HostProcess.Environment;
  const cwd = yield* HostProcess.WorkingDirectory;

  const read = Effect.fn("NativeSessionContext.read")(function* (input: {
    readonly provider: "codex" | "claude";
    readonly reference: string;
    readonly codexHome?: string;
  }) {
    const reference = input.reference.trim();
    const id = reference.replace(/^(?:codex:\/\/threads\/|codex:|claude:)/, "");
    const isSessionId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (input.provider === "claude") {
      if (!isSessionId)
        return yield* new NativeSessionContextError({
          detail:
            "Pass a Claude session UUID or claude:<session-id>. Use /status in Claude Code to find its session ID, or /export to copy its transcript.",
        });
      const messages = yield* Effect.tryPromise({
        try: () => getSessionMessages(id),
        catch: (cause) =>
          new NativeSessionContextError({
            detail: `Could not read Claude session ${id}. Check CLAUDE_CONFIG_DIR or use /export in Claude Code.`,
            cause,
          }),
      });
      const entries = messages.flatMap((entry) => {
        if (entry.type !== "user" && entry.type !== "assistant") return [];
        const text = messageText(object(entry.message)?.content);
        return text ? [{ role: entry.type, text }] : [];
      });
      if (entries.length === 0)
        return yield* new NativeSessionContextError({
          detail: `No conversation text was found for Claude session ${id} on this machine.`,
        });
      return {
        title: `Claude Code session ${id}`,
        reference: `claude:${id}`,
        entries,
      } satisfies ConversationContext;
    }

    let sessionPath: string;
    if (isSessionId) {
      const codexHome = path.resolve(
        cwd,
        expandHomePath(
          input.codexHome ?? environment.CODEX_HOME ?? path.join(home, ".codex"),
          home,
        ),
      );
      let match: string | undefined;
      for (const directory of ["sessions", "archived_sessions"]) {
        const root = path.join(codexHome, directory);
        const files = yield* fs.readDirectory(root, { recursive: true }).pipe(
          Effect.catch((cause) =>
            cause.reason._tag === "NotFound"
              ? Effect.succeed([])
              : Effect.fail(
                  new NativeSessionContextError({
                    detail: `Could not search Codex sessions in ${root}.`,
                    cause,
                  }),
                ),
          ),
        );
        const matches = files.filter(
          (file) => file.endsWith(`-${id}.jsonl`) || path.basename(file) === `${id}.jsonl`,
        );
        if (matches.length > 1)
          return yield* new NativeSessionContextError({
            detail: `More than one Codex transcript matches ${id}. Pass the conversation file path with --source codex.`,
          });
        if (matches[0]) {
          match = path.join(root, matches[0]);
          break;
        }
      }
      if (!match)
        return yield* new NativeSessionContextError({
          detail: `Codex session ${id} was not found. Pass --codex-home for its data directory, or copy its conversation path from Codex.`,
        });
      sessionPath = match;
    } else {
      if (!reference.endsWith(".jsonl") || reference.includes("://"))
        return yield* new NativeSessionContextError({
          detail:
            "Pass a codex://threads/<session-id> link, a Codex UUID, or a .jsonl conversation file path.",
        });
      sessionPath = path.resolve(cwd, expandHomePath(reference, home));
    }
    const stat = yield* fs
      .stat(sessionPath)
      .pipe(
        Effect.mapError(
          (cause) =>
            new NativeSessionContextError({ detail: `Could not read ${sessionPath}.`, cause }),
        ),
      );
    if (stat.size > 64 * 1024 * 1024)
      return yield* new NativeSessionContextError({
        detail: "This Codex transcript exceeds the 64 MiB export limit.",
      });
    const contents = yield* fs
      .readFileString(sessionPath)
      .pipe(
        Effect.mapError(
          (cause) =>
            new NativeSessionContextError({ detail: `Could not read ${sessionPath}.`, cause }),
        ),
      );
    const entries: Array<ConversationContext["entries"][number]> = [];
    let sessionId: string | undefined;
    let workspacePath: string | undefined;
    const lines = contents.split("\n");
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      const decoded = decodeJson(line);
      if (Option.isNone(decoded)) {
        // A running session can be between writes of its final record.
        if (index === lines.length - 1) break;
        return yield* new NativeSessionContextError({
          detail: `Invalid JSON at line ${index + 1} of ${sessionPath}.`,
        });
      }
      const record = object(decoded.value);
      const payload = object(record?.payload);
      if (!payload) continue;
      if (record?.type === "session_meta" && sessionId === undefined) {
        sessionId =
          typeof payload.id === "string"
            ? payload.id
            : typeof payload.session_id === "string"
              ? payload.session_id
              : undefined;
        workspacePath = typeof payload.cwd === "string" ? payload.cwd : undefined;
      }
      if (
        record?.type === "response_item" &&
        payload.type === "message" &&
        (payload.role === "user" || payload.role === "assistant")
      ) {
        const text = messageText(payload.content);
        if (text) entries.push({ role: payload.role, text });
      }
      if (
        record?.type === "event_msg" &&
        payload.type === "thread_rolled_back" &&
        typeof payload.num_turns === "number"
      ) {
        for (let remaining = payload.num_turns; remaining > 0; remaining--) {
          const userIndex = entries.findLastIndex((entry) => entry.role === "user");
          if (userIndex < 0) break;
          entries.splice(userIndex);
        }
      }
    }
    if (!sessionId || (isSessionId && sessionId !== id))
      return yield* new NativeSessionContextError({
        detail: "The Codex transcript session ID does not match the requested session.",
      });
    if (entries.length === 0)
      return yield* new NativeSessionContextError({
        detail: "This Codex transcript contains no saved conversation text.",
      });
    return {
      title: `Codex session ${sessionId}`,
      reference: `codex://threads/${sessionId}`,
      workspacePath: workspacePath ?? null,
      entries,
    } satisfies ConversationContext;
  });
  return NativeSessionContext.of({ read });
});

export const layer = Layer.effect(NativeSessionContext, make);
