import { assert, it } from "@effect/vitest";
import { RunId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { type ThreadTools, readThreadContext, waitForRun } from "./thread.ts";

const threadId = ThreadId.make("thread-1");
const runId = RunId.make("run-1");

/** Answers each tool call with the next scripted response for that tool. */
const scriptedTools = (script: Record<string, Array<unknown>>) => {
  const calls: Array<{ readonly tool: string; readonly args: unknown }> = [];
  const call = ((tool: string, args: unknown) => {
    calls.push({ tool, args });
    const next = script[tool]?.shift();
    return next === undefined ? Effect.die(`unscripted ${tool} call`) : Effect.succeed(next);
  }) as ThreadTools["call"];
  return { tools: { call } satisfies ThreadTools, calls };
};

it.effect("export reads every message page and every long-text chunk in order", () =>
  Effect.gen(function* () {
    const thread = {
      title: "Build the handoff",
      updatedAt: "2026-10-23T12:00:00Z",
      worktreePath: "/workspace",
      branch: "feature/context",
    };
    const { tools, calls } = scriptedTools({
      t3_environment_read: [{ environmentId: "local-env" }],
      t3_thread_read: [
        {
          thread,
          items: [{ itemId: "user-1", type: "user_message", text: "First", textTruncated: false }],
          hasMore: true,
          nextPosition: 1,
        },
        {
          thread,
          items: [
            {
              itemId: "assistant-1",
              type: "assistant_message",
              text: "Long ",
              textTruncated: true,
              nextTextOffset: 5,
            },
            { itemId: "plan-1", type: "proposed_plan", text: "1. Implement", textTruncated: false },
          ],
          hasMore: false,
          nextPosition: null,
        },
        { items: [{ itemId: "assistant-1", text: "message", textTruncated: false }] },
      ],
    });
    const context = yield* readThreadContext(tools, threadId, "local-env");
    assert.deepStrictEqual(context.entries, [
      { role: "user", text: "First" },
      { role: "assistant", text: "Long message" },
      { role: "plan", text: "1. Implement" },
    ]);
    assert.equal(context.workspacePath, "/workspace");
    assert.deepStrictEqual(calls.at(-1)?.args, {
      threadId,
      itemId: "assistant-1",
      textOffset: 5,
      runLimit: 1,
    });
  }),
);

it.effect("export includes the project workspace for threads in the main checkout", () =>
  Effect.gen(function* () {
    const { tools } = scriptedTools({
      t3_environment_read: [{ environmentId: "local-env" }],
      t3_thread_read: [
        {
          thread: { title: "Root thread", projectId: "project-1", worktreePath: null },
          items: [],
          hasMore: false,
        },
      ],
      t3_project_read: [{ workspaceRoot: "/main-checkout" }],
    });
    assert.equal((yield* readThreadContext(tools, threadId)).workspacePath, "/main-checkout");
  }),
);

it.effect("export checks the environment before reading another thread", () =>
  Effect.gen(function* () {
    const { tools, calls } = scriptedTools({
      t3_environment_read: [{ environmentId: "other-env" }],
    });
    const result = yield* readThreadContext(tools, threadId, "source-env").pipe(Effect.flip);
    assert.equal(result._tag, "ThreadUsageError");
    assert.equal(calls.length, 1);
  }),
);

it.effect("export fails when a text continuation cannot be retrieved", () =>
  Effect.gen(function* () {
    const { tools } = scriptedTools({
      t3_environment_read: [{ environmentId: "local-env" }],
      t3_thread_read: [
        {
          thread: {},
          items: [
            {
              itemId: "user-1",
              type: "user_message",
              text: "Partial",
              textTruncated: true,
              nextTextOffset: 7,
            },
          ],
          hasMore: false,
        },
        { items: [] },
      ],
      t3_project_read: [{ workspaceRoot: "/workspace" }],
    });
    const result = yield* readThreadContext(tools, threadId).pipe(Effect.flip);
    assert.equal(result._tag, "ThreadToolFailedError");
  }),
);

it.effect("--wait follows the sent run to its continuation's terminal status", () =>
  Effect.gen(function* () {
    const continuation = RunId.make("run-2");
    const { tools, calls } = scriptedTools({
      t3_thread_wait: [
        { threadId, runId, status: "running", timedOut: true },
        { threadId, runId: continuation, status: "failed", timedOut: false },
      ],
      t3_thread_read: [{ thread: { pendingRequestCount: 0 } }],
    });

    const outcome = yield* waitForRun(tools, threadId, runId);

    assert.deepStrictEqual(outcome, { type: "ended", runId: continuation, status: "failed" });
    assert.deepStrictEqual(
      calls.filter((entry) => entry.tool === "t3_thread_wait").map((entry) => entry.args),
      [
        { threadId, runId, timeoutMs: 15_000 },
        { threadId, runId, timeoutMs: 15_000 },
      ],
    );
  }),
);

it.effect("--wait stops when the thread waits for an answer instead of polling forever", () =>
  Effect.gen(function* () {
    const { tools } = scriptedTools({
      t3_thread_wait: [
        { threadId, runId, status: "queued", timedOut: true },
        { threadId, runId, status: "queued", timedOut: true },
      ],
      t3_thread_read: [{ thread: { pendingRequestCount: 1 } }],
    });

    assert.deepStrictEqual(yield* waitForRun(tools, threadId, runId), { type: "needs_input" });
  }),
);

it.effect("--wait reports its run's result when a later run is the one waiting", () =>
  Effect.gen(function* () {
    const { tools } = scriptedTools({
      t3_thread_wait: [
        { threadId, runId, status: "running", timedOut: true },
        { threadId, runId, status: "completed", timedOut: false },
      ],
      t3_thread_read: [{ thread: { pendingRequestCount: 1 } }],
    });

    assert.deepStrictEqual(yield* waitForRun(tools, threadId, runId), {
      type: "ended",
      runId,
      status: "completed",
    });
  }),
);
