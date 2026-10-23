import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { vi } from "vite-plus/test";
import * as NativeSessionContext from "./NativeSessionContext.ts";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ getSessionMessages: vi.fn() }));
const id = "01994b5a-1234-7000-8000-123456789abc";
const meta = { type: "session_meta", payload: { id, cwd: "/workspace" } };
const message = (role: string, text: string) => ({
  type: "response_item",
  payload: {
    type: "message",
    role,
    content: [{ type: role === "user" ? "input_text" : "output_text", text }],
  },
});
const testLayer = NativeSessionContext.layer.pipe(Layer.provideMerge(NodeServices.layer));

it.effect(
  "reads archived Codex context with literal code and excludes duplicate events and reasoning",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped();
      yield* fs.makeDirectory(`${root}/archived_sessions`);
      const code = "Keep whitespace\n\n```ts\nconst x = 1;\n```";
      yield* fs.writeFileString(
        `${root}/archived_sessions/rollout-2026-10-23-${id}.jsonl`,
        [
          meta,
          message("developer", "private setup"),
          message("user", code),
          { type: "event_msg", payload: { type: "user_message", message: code } },
          { type: "response_item", payload: { type: "reasoning", encrypted_content: "opaque" } },
          message("assistant", "Done"),
        ]
          .map((record) => JSON.stringify(record))
          .join("\n") + '\n{"type":',
      );
      const reader = yield* NativeSessionContext.NativeSessionContext;
      const context = yield* reader.read({
        provider: "codex",
        reference: `codex://threads/${id}`,
        codexHome: root,
      });
      assert.equal(context.workspacePath, "/workspace");
      assert.deepStrictEqual(context.entries, [
        { role: "user", text: code },
        { role: "assistant", text: "Done" },
      ]);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
);

it.effect("honors Codex rollback and reads an explicit conversation path", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    const file = `${root}/conversation.jsonl`;
    yield* fs.writeFileString(
      file,
      [
        meta,
        message("user", "Keep"),
        message("assistant", "Kept"),
        message("user", "Discard"),
        message("assistant", "Discarded"),
        { type: "event_msg", payload: { type: "thread_rolled_back", num_turns: 1 } },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n"),
    );
    const context = yield* (yield* NativeSessionContext.NativeSessionContext).read({
      provider: "codex",
      reference: file,
    });
    assert.deepStrictEqual(
      context.entries.map((entry) => entry.text),
      ["Keep", "Kept"],
    );
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);

it.effect("uses CODEX_HOME and rejects a file naming a different session", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    yield* fs.makeDirectory(`${root}/sessions/2026/10/23`, { recursive: true });
    yield* fs.writeFileString(
      `${root}/sessions/2026/10/23/rollout-${id}.jsonl`,
      JSON.stringify({ ...meta, payload: { id: "another-session" } }) +
        "\n" +
        JSON.stringify(message("user", "other thread")),
    );
    const result = yield* Effect.gen(function* () {
      const reader = yield* NativeSessionContext.NativeSessionContext;
      return yield* reader.read({ provider: "codex", reference: id }).pipe(Effect.flip);
    }).pipe(
      Effect.provide(NativeSessionContext.layer),
      Effect.provideService(HostProcess.Environment, { CODEX_HOME: root }),
    );
    assert.equal(result._tag, "NativeSessionContextError");
    assert.include(result.message, "does not match");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("reads Claude conversation text through its read-only history API", () =>
  Effect.gen(function* () {
    vi.mocked(getSessionMessages).mockResolvedValue([
      {
        type: "user",
        uuid: "u1",
        session_id: id,
        parent_tool_use_id: null,
        parent_agent_id: null,
        message: { content: "Question" },
      },
      {
        type: "assistant",
        uuid: "a1",
        session_id: id,
        parent_tool_use_id: null,
        parent_agent_id: null,
        message: {
          content: [
            { type: "thinking", thinking: "private" },
            { type: "text", text: "Answer" },
            { type: "tool_use", name: "Bash", input: {} },
          ],
        },
      },
    ]);
    const context = yield* (yield* NativeSessionContext.NativeSessionContext).read({
      provider: "claude",
      reference: `claude:${id}`,
    });
    assert.deepStrictEqual(context.entries, [
      { role: "user", text: "Question" },
      { role: "assistant", text: "Answer" },
    ]);
    assert.deepStrictEqual(vi.mocked(getSessionMessages).mock.lastCall, [id]);
  }).pipe(Effect.provide(testLayer)),
);

it.effect("reports missing sessions and unsupported native links clearly", () =>
  Effect.gen(function* () {
    const reader = yield* NativeSessionContext.NativeSessionContext;
    const missing = yield* reader
      .read({ provider: "codex", reference: id, codexHome: "/missing-codex-home" })
      .pipe(Effect.flip);
    assert.include(missing.message, "was not found");
    const unsupported = yield* reader
      .read({ provider: "codex", reference: "codex://threads/new" })
      .pipe(Effect.flip);
    assert.include(unsupported.message, "Pass a codex://threads/");
  }).pipe(Effect.provide(testLayer)),
);
