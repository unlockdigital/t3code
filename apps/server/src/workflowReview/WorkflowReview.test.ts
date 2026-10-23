import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Persistence from "../persistence/Sqlite.ts";
import * as SkillLibrary from "../skills/SkillLibrary.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as WorkflowReview from "./WorkflowReview.ts";
import type * as Review from "./schemas.ts";

const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const layer = WorkflowReview.layer.pipe(
  Layer.provideMerge(ServerSettings.layerTest()),
  Layer.provideMerge(Persistence.layerMemory),
  Layer.provide(Layer.mock(SkillLibrary.SkillLibrary)({ catalog: "existing: Prepare a release." })),
  Layer.provideMerge(NodeServices.layer),
);
const seed = Effect.fn("WorkflowReview.test.seed")(function* (
  suffix: string,
  options: {
    parent?: string;
    scheduled?: boolean;
    createdBy?: string;
    daysOld?: number;
    status?: string;
    text?: string;
    thread?: string;
    project?: string;
    private?: boolean;
  } = {},
) {
  const sql = yield* SqlClient.SqlClient;
  const completedAt = DateTime.formatIso(
    DateTime.subtract(yield* DateTime.now, { days: options.daysOld ?? 1 }),
  );
  const threadId = ThreadId.make(options.thread ?? `thread-${suffix}`);
  const runId = RunId.make(`run-${suffix}`);
  const projectId = options.project ?? "project-test";
  yield* sql`INSERT OR IGNORE INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
    VALUES (${projectId}, 'Test', '/tmp/test', '[]', ${completedAt}, ${completedAt})`;
  yield* sql`INSERT OR IGNORE INTO orchestration_v2_projection_threads
    (thread_id, project_id, title, default_provider, runtime_mode, interaction_mode, created_at, updated_at, payload_json)
    VALUES (${threadId}, ${projectId}, 'Release workflow', 'codex', 'auto', 'default', ${completedAt}, ${completedAt}, ${json({ lineage: { parentThreadId: options.parent ?? null }, ...(options.private ? { privateModelRoute: { modelSelection: { instanceId: "synthetic-private", model: "tinfoil/synthetic" }, providerConfigHash: "synthetic-route" } } : {}) })})`;
  yield* sql`INSERT INTO orchestration_v2_projection_runs
    (run_id, thread_id, ordinal, provider, status, requested_at, completed_at, payload_json)
    VALUES (${runId}, ${threadId}, ${Number(suffix.replace(/\D/g, "")) || 1}, 'codex', ${options.status ?? "completed"}, ${completedAt}, ${completedAt}, ${json({ userMessageId: `message-${suffix}` })})`;
  yield* sql`INSERT INTO orchestration_v2_projection_messages
    (message_id, thread_id, run_id, role, streaming, created_at, updated_at, payload_json)
    VALUES (${`message-${suffix}`}, ${threadId}, ${runId}, 'user', 0, ${completedAt}, ${completedAt}, ${json({ text: options.text ?? "Prepare the release report.", createdBy: options.createdBy ?? "user", ...(options.scheduled ? { scheduledTaskId: "weekly" } : {}) })})`;
  yield* sql`INSERT INTO orchestration_v2_projection_messages
    (message_id, thread_id, run_id, role, streaming, created_at, updated_at, payload_json)
    VALUES (${`assistant-${suffix}`}, ${threadId}, ${runId}, 'assistant', 0, ${completedAt}, ${completedAt}, ${json({ text: options.text ?? "Verified the release report." })})`;
  yield* sql`INSERT INTO orchestration_v2_projection_turn_items
    (turn_item_id, thread_id, run_id, ordinal, type, status, updated_at, payload_json)
    VALUES (${`tool-${suffix}`}, ${threadId}, ${runId}, 1, 'mcp_tool_call', 'completed', ${completedAt}, ${json({ toolName: "read_report", arguments: "PRIVATE-ARGUMENT", result: "PRIVATE-RESULT" })})`;
  return runId;
});
const proposal = (ids: ReadonlyArray<RunId>, stage: "proposed" | "watching" = "proposed") =>
  ({
    key: "release-evidence",
    kind: "skill",
    title: "Prepare release evidence",
    trigger: "Prepare a release evidence packet.",
    rationale: "Repeated evidence preparation across independent tasks.",
    confidence: "medium",
    stage,
    evidenceRunIds: ids,
  }) satisfies typeof Review.Proposal.Type;

it.effect("keeps explicit private threads and private projects out of ordinary review", () =>
  Effect.gen(function* () {
    yield* seed("1", { private: true, text: "INVENTED_PRIVATE_THREAD_CANARY" });
    yield* seed("2", { project: "private-project", text: "INVENTED_PRIVATE_PROJECT_CANARY" });
    const ordinary = yield* seed("3");
    const settings = yield* ServerSettings.ServerSettingsService;
    yield* settings.updateSettings({
      projectSettingsOverrides: {
        [ProjectId.make("private-project")]: { modelPrivacy: "private" },
      },
    });
    const service = yield* WorkflowReview.WorkflowReview;
    const packet = yield* service.digest("privacy");
    expect(packet.evidence.map((record) => record.runId)).toEqual([ordinary]);
    expect(json(packet)).not.toContain("CANARY");
  }).pipe(Effect.provide(layer)),
);

it.effect("invalidates cached evidence and excerpts when a project becomes private", () =>
  Effect.gen(function* () {
    const source = yield* seed("1", { text: "INVENTED_NEW_PRIVATE_CANARY" });
    const service = yield* WorkflowReview.WorkflowReview;
    const first = yield* service.digest("private-after-cache");
    const settings = yield* ServerSettings.ServerSettingsService;
    yield* settings.updateSettings({
      projectSettingsOverrides: { [ProjectId.make("project-test")]: { modelPrivacy: "private" } },
    });
    expect(
      yield* Effect.flip(
        service.excerpt({ reviewId: "private-after-cache", batchId: first.batchId, runId: source }),
      ),
    ).toMatchObject({ reason: "stale_batch" });
    const next = yield* service.digest("private-after-cache");
    expect(next.batchId).not.toBe(first.batchId);
    expect(next.evidence).toEqual([]);
    expect(json(next)).not.toContain("CANARY");
  }).pipe(Effect.provide(layer)),
);

it.effect("drops cached candidate prose when any cited thread becomes private", () =>
  Effect.gen(function* () {
    const source = yield* seed("1");
    const service = yield* WorkflowReview.WorkflowReview;
    const first = yield* service.digest("private-candidate");
    yield* service.save({
      action: "complete",
      reviewId: "private-candidate",
      batchId: first.batchId,
      report: "INVENTED_CANDIDATE_CANARY",
      proposals: [{ ...proposal([source], "watching"), rationale: "INVENTED_CANDIDATE_CANARY" }],
    });
    const cached = yield* service.digest("private-candidate");
    expect(json(cached)).toContain("INVENTED_CANDIDATE_CANARY");
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE orchestration_v2_projection_threads SET payload_json = json_set(payload_json, '$.privateModelRoute', json('{}')) WHERE thread_id = 'thread-1'`;
    const next = yield* service.digest("private-candidate");
    expect(next.candidates).toEqual([]);
    expect(next.candidateCount).toBe(0);
    expect(json(next)).not.toContain("CANARY");
    expect(
      yield* Effect.flip(
        service.save({
          action: "complete",
          reviewId: "private-candidate",
          batchId: cached.batchId,
          report: "stale",
          proposals: [],
        }),
      ),
    ).toMatchObject({ reason: "stale_batch" });
  }).pipe(Effect.provide(layer)),
);

it.effect("applies environment privacy with explicit Standard project overrides", () =>
  Effect.gen(function* () {
    yield* seed("1", { project: "inherits-private", text: "INVENTED_GLOBAL_PRIVATE_CANARY" });
    const ordinary = yield* seed("2", { project: "ordinary-project" });
    yield* seed("3", {
      project: "ordinary-project",
      private: true,
      text: "INVENTED_LOCKED_CANARY",
    });
    const settings = yield* ServerSettings.ServerSettingsService;
    yield* settings.updateSettings({
      modelPrivacy: "private",
      projectSettingsOverrides: {
        [ProjectId.make("ordinary-project")]: { modelPrivacy: "standard" },
      },
    });
    const service = yield* WorkflowReview.WorkflowReview;
    const packet = yield* service.digest("global-privacy");
    expect(packet.evidence.map((record) => record.runId)).toEqual([ordinary]);
    expect(json(packet)).not.toContain("CANARY");
  }).pipe(Effect.provide(layer)),
);

it.effect(
  "collects bounded human workflows while excluding automation, children, old and active work",
  () =>
    Effect.gen(function* () {
      const keep = yield* seed("1");
      yield* seed("2", { parent: "parent" });
      yield* seed("3", { scheduled: true });
      yield* seed("4", { createdBy: "agent" });
      yield* seed("5", { daysOld: 8 });
      yield* seed("6", { status: "running" });
      const service = yield* WorkflowReview.WorkflowReview;
      const packet = yield* service.digest("weekly-skills");
      expect(packet.evidence.map((record) => record.runId)).toEqual([keep]);
      expect(packet.catalog).toContain("existing:");
      expect(packet.evidence[0]?.toolSequence).toEqual(["read_report"]);
      expect(json(packet)).not.toContain("PRIVATE-");
    }).pipe(Effect.provide(layer)),
);
it.effect("retries a frozen batch and advances only after a successful idempotent save", () =>
  Effect.gen(function* () {
    yield* seed("1");
    const service = yield* WorkflowReview.WorkflowReview;
    const first = yield* service.digest("retry");
    yield* seed("2");
    expect(yield* service.digest("retry")).toEqual(first);
    const save = {
      action: "complete",
      reviewId: "retry",
      batchId: first.batchId,
      report: "No candidate has sufficient evidence.",
      proposals: [],
    } as const;
    yield* service.save(save);
    yield* service.save(save);
    const next = yield* service.digest("retry");
    expect(next.evidence.map((item) => item.runId)).toEqual(["run-2"]);
    expect((yield* service.save({ ...save, batchId: "stale" }).pipe(Effect.flip)).reason).toBe(
      "stale_batch",
    );
  }).pipe(Effect.provide(layer)),
);
it.effect("carries unreviewed evidence forward when a UTF-8 byte budget fills", () =>
  Effect.gen(function* () {
    for (let i = 1; i <= 24; i++)
      yield* seed(String(i).padStart(2, "0"), { text: "🌍".repeat(2_000) });
    const service = yield* WorkflowReview.WorkflowReview;
    const first = yield* service.digest("bounded");
    expect(new TextEncoder().encode(json(first)).length).toBeLessThanOrEqual(28_000);
    expect(first.hasMore).toBe(true);
    yield* service.save({
      action: "complete",
      reviewId: "bounded",
      batchId: first.batchId,
      report: "Coverage is partial.",
      proposals: [],
    });
    const next = yield* service.digest("bounded");
    expect(next.evidence.length).toBeGreaterThan(0);
    expect(
      next.evidence.every(
        (item) => !first.evidence.some((previous) => previous.runId === item.runId),
      ),
    ).toBe(true);
  }).pipe(Effect.provide(layer)),
);
it.effect("caps deeper inspections and rejects evidence outside the batch", () =>
  Effect.gen(function* () {
    const ids: RunId[] = [];
    for (let i = 1; i <= 4; i++) ids.push(yield* seed(String(i)));
    const service = yield* WorkflowReview.WorkflowReview;
    const packet = yield* service.digest("inspections");
    for (const runId of ids.slice(0, 3))
      yield* service.excerpt({ reviewId: "inspections", batchId: packet.batchId, runId });
    expect(
      (yield* service
        .excerpt({ reviewId: "inspections", batchId: packet.batchId, runId: ids[3]! })
        .pipe(Effect.flip)).reason,
    ).toBe("excerpt_limit");
    expect(
      (yield* service
        .excerpt({
          reviewId: "inspections",
          batchId: packet.batchId,
          runId: RunId.make("invented"),
        })
        .pipe(Effect.flip)).reason,
    ).toBe("evidence");
  }).pipe(Effect.provide(layer)),
);
it.effect("requires independent thread evidence and remembers declined candidates", () =>
  Effect.gen(function* () {
    const one = yield* seed("1");
    const two = yield* seed("2");
    const service = yield* WorkflowReview.WorkflowReview;
    const first = yield* service.digest("decisions");
    const save = {
      action: "complete",
      reviewId: "decisions",
      batchId: first.batchId,
      report: "Recommend a reusable release workflow.",
    } as const;
    expect(
      (yield* service.save({ ...save, proposals: [proposal([one])] }).pipe(Effect.flip)).reason,
    ).toBe("evidence");
    yield* service.save({ ...save, proposals: [proposal([one, two])] });
    yield* service.save({
      action: "decide",
      reviewId: "decisions",
      key: "release-evidence",
      decision: "declined",
    });
    const next = yield* service.digest("decisions");
    expect(next.candidates[0]?.decision).toBe("declined");
    const result = yield* service.save({
      ...save,
      batchId: next.batchId,
      proposals: [proposal([one, two])],
    });
    expect(result.suppressedKeys).toEqual(["release-evidence"]);
  }).pipe(Effect.provide(layer)),
);
it.effect("rejects invented citations and keeps the checkpoint unchanged on failure", () =>
  Effect.gen(function* () {
    yield* seed("1");
    const service = yield* WorkflowReview.WorkflowReview;
    const packet = yield* service.digest("citations");
    expect(
      (yield* service
        .save({
          action: "complete",
          reviewId: "citations",
          batchId: packet.batchId,
          report: "Candidate.",
          proposals: [proposal([RunId.make("invented")], "watching")],
        })
        .pipe(Effect.flip)).reason,
    ).toBe("evidence");
    expect(yield* service.digest("citations")).toEqual(packet);
  }).pipe(Effect.provide(layer)),
);

it.effect("treats follow-up runs in one thread as one source for new skills", () =>
  Effect.gen(function* () {
    const one = yield* seed("1", { thread: "same-project-thread" });
    const two = yield* seed("2", { thread: "same-project-thread" });
    const service = yield* WorkflowReview.WorkflowReview;
    const packet = yield* service.digest("independent");
    const save = {
      action: "complete",
      reviewId: "independent",
      batchId: packet.batchId,
      report: "This pattern is still being observed.",
    } as const;
    expect(
      (yield* service.save({ ...save, proposals: [proposal([one, two])] }).pipe(Effect.flip))
        .reason,
    ).toBe("evidence");
    yield* service.save({ ...save, proposals: [proposal([one, two], "watching")] });
    expect((yield* service.digest("independent")).candidates[0]?.stage).toBe("watching");
  }).pipe(Effect.provide(layer)),
);

it.effect("reports scoped latest-attempt usage without summing cache reads or context size", () =>
  Effect.gen(function* () {
    const runId = yield* seed("1");
    const sql = yield* SqlClient.SqlClient;
    for (const ordinal of [1, 2]) {
      yield* sql`INSERT INTO orchestration_v2_projection_provider_turns
        (provider_turn_id, thread_id, provider_thread_id, node_id, ordinal, status, payload_json)
        VALUES (${`turn-${ordinal}`}, 'thread-1', 'provider-thread', ${`node-${ordinal}`}, ${ordinal}, 'completed', ${json(
          {
            tokenUsage: { usedTokens: 999_999 },
            turnTokenUsage: {
              usageScope: "main_agent",
              usageStatus: "complete",
              inputTokens: ordinal * 100,
              cachedInputTokens: 50,
              outputTokens: 20,
              hasSubagents: false,
            },
          },
        )})`;
      yield* sql`INSERT INTO orchestration_v2_projection_run_attempts
        (attempt_id, thread_id, run_id, attempt_ordinal, root_node_id, provider, provider_thread_id, provider_turn_id, status, payload_json)
        VALUES (${`attempt-${ordinal}`}, 'thread-1', ${runId}, ${ordinal}, ${`node-${ordinal}`}, 'codex', 'provider-thread', ${`turn-${ordinal}`}, 'completed', '{}')`;
    }
    const service = yield* WorkflowReview.WorkflowReview;
    const packet = yield* service.digest("metrics");
    expect(packet.evidence[0]?.latestAttemptUsage).toEqual({
      usageScope: "main_agent",
      usageStatus: "complete",
      inputTokens: 200,
      cachedInputTokens: 50,
      outputTokens: 20,
      hasSubagents: false,
    });
  }).pipe(Effect.provide(layer)),
);
