import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SkillLibrary from "../skills/SkillLibrary.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Review from "./schemas.ts";

const DIGEST_BYTES = 28_000;
const EXCERPT_BYTES = 4_000;
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const byteLength = (value: unknown) => new TextEncoder().encode(encodeJson(value)).length;
const shortText = (text: string, bytes: number, tail = false) => {
  const encoded = new TextEncoder().encode(text);
  if (encoded.length <= bytes) return text;
  return new TextDecoder().decode(tail ? encoded.slice(-(bytes - 3)) : encoded.slice(0, bytes - 3));
};
const decodeState = Schema.decodeUnknownEffect(Schema.fromJsonString(Review.State));
const decodeEvidence = Schema.decodeUnknownEffect(Schema.Array(Review.Evidence));
const decodeUsage = Schema.decodeUnknownEffect(Schema.fromJsonString(TurnTokenUsage));

export class WorkflowReviewError extends Schema.TaggedError<WorkflowReviewError>()(
  "WorkflowReviewError",
  {
    reason: Schema.Literals([
      "storage",
      "stale_batch",
      "excerpt_limit",
      "evidence",
      "budget",
      "candidate",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    return `Workflow review could not complete (${this.reason}).`;
  }
}
const isWorkflowReviewError = Schema.is(WorkflowReviewError);

export class WorkflowReview extends Context.Service<
  WorkflowReview,
  {
    readonly digest: (
      reviewId: string,
    ) => Effect.Effect<typeof Review.Digest.Type, WorkflowReviewError>;
    readonly excerpt: (
      input: typeof Review.ExcerptInput.Type,
    ) => Effect.Effect<typeof Review.Excerpt.Type, WorkflowReviewError>;
    readonly save: (
      input: typeof Review.SaveInput.Type,
    ) => Effect.Effect<typeof Review.SaveResult.Type, WorkflowReviewError>;
  }
>()("t3/workflowReview/WorkflowReview") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;
  const library = yield* SkillLibrary.SkillLibrary;
  const settings = yield* ServerSettings.ServerSettingsService;
  const publicSources = Effect.fn("WorkflowReview.publicSources")(function* () {
    const current = yield* settings.getRoutingSettings;
    const overrides = Object.entries(current.projectSettingsOverrides);
    const projects =
      current.modelPrivacy === "private"
        ? sql`t.project_id IN ${sql.in(overrides.filter(([, value]) => value.modelPrivacy === "standard").map(([id]) => id))}`
        : sql`t.project_id NOT IN ${sql.in(overrides.filter(([, value]) => value.modelPrivacy === "private").map(([id]) => id))}`;
    return sql`json_extract(t.payload_json, '$.privateModelRoute') IS NULL AND ${projects}`;
  });
  const load = Effect.fn("WorkflowReview.load")(function* (reviewId: string) {
    const now = DateTime.formatIso(yield* DateTime.now);
    const rows = yield* sql<{
      revision: number;
      payload_json: string;
    }>`SELECT revision, payload_json FROM workflow_reviews WHERE review_id = ${reviewId}`;
    const row = rows[0];
    let state =
      row === undefined
        ? ({
            cursor: {
              at: DateTime.formatIso(DateTime.subtract(DateTime.makeUnsafe(now), { days: 7 })),
              runId: "",
            },
            candidates: [],
            pending: null,
            lastBatchId: null,
            lastReport: null,
          } satisfies typeof Review.State.Type)
        : yield* decodeState(row.payload_json);
    const sourceFilter = yield* publicSources();
    // Cached prose keeps its source restrictions when a project or thread becomes private.
    const ids = [
      ...new Set([
        ...state.candidates.flatMap((candidate) => candidate.evidenceRunIds),
        ...(state.pending?.digest.evidence.map((item) => item.runId) ?? []),
        ...(state.pending?.digest.candidates.flatMap((candidate) => candidate.evidenceRunIds) ??
          []),
      ]),
    ];
    if (ids.length > 0) {
      const available = yield* sql<{ runId: string }>`SELECT r.run_id AS runId
        FROM orchestration_v2_projection_runs r
        JOIN orchestration_v2_projection_threads t ON t.thread_id = r.thread_id
        JOIN projection_projects p ON p.project_id = t.project_id
        WHERE r.run_id IN ${sql.in(ids)} AND t.deleted_at IS NULL AND p.deleted_at IS NULL AND ${sourceFilter}`;
      const allowed = new Set(available.map((item) => item.runId));
      if (ids.some((id) => !allowed.has(id)))
        state = {
          ...state,
          candidates: state.candidates.filter((candidate) =>
            candidate.evidenceRunIds.every((id) => allowed.has(id)),
          ),
          pending: null,
          lastBatchId: null,
          lastReport: null,
        };
    }
    return { now, state, revision: row?.revision ?? 0, sourceFilter };
  });
  const persist = Effect.fn("WorkflowReview.persist")(function* (
    reviewId: string,
    revision: number,
    state: typeof Review.State.Type,
  ) {
    // The revision guards concurrent processes as well as concurrent callers.
    const rows = yield* sql`INSERT INTO workflow_reviews (review_id, revision, payload_json)
      VALUES (${reviewId}, 1, ${encodeJson(state)})
      ON CONFLICT(review_id) DO UPDATE SET revision = revision + 1, payload_json = excluded.payload_json
      WHERE revision = ${revision} RETURNING revision`;
    if (rows.length === 0) return yield* new WorkflowReviewError({ reason: "stale_batch" });
  });
  const digest = Effect.fn("WorkflowReview.digest")(
    function* (reviewId: string) {
      const { now, state, revision, sourceFilter } = yield* load(reviewId);
      if (state.pending !== null) return state.pending.digest;
      // SQL truncates the projected text before it reaches JS. Tool arguments,
      // tool output, reasoning and attachments stay out of the evidence packet.
      const rows =
        yield* sql`SELECT r.run_id AS runId, r.thread_id AS threadId, t.project_id AS projectId,
      substr(t.title, 1, 120) AS title, r.completed_at AS completedAt, r.status,
      substr(json_extract(m.payload_json, '$.text'), 1, 360) AS request,
      COALESCE((SELECT substr(json_extract(a.payload_json, '$.text'), -440)
        FROM orchestration_v2_projection_messages a WHERE a.run_id = r.run_id AND a.role = 'assistant' AND a.streaming = 0
        ORDER BY a.created_at DESC, a.message_id DESC LIMIT 1), '') AS outcome
      FROM orchestration_v2_projection_runs r INDEXED BY orchestration_v2_runs_review_idx
      JOIN orchestration_v2_projection_threads t ON t.thread_id = r.thread_id
      JOIN projection_projects p ON p.project_id = t.project_id
      JOIN orchestration_v2_projection_messages m ON m.message_id = json_extract(r.payload_json, '$.userMessageId')
      WHERE r.status IN ('completed', 'failed', 'cancelled', 'interrupted')
        AND (r.completed_at, r.run_id) > (${state.cursor.at}, ${state.cursor.runId}) AND r.completed_at <= ${now}
        AND t.deleted_at IS NULL AND p.deleted_at IS NULL
        AND ${sourceFilter}
        AND json_extract(t.payload_json, '$.lineage.parentThreadId') IS NULL
        AND m.role = 'user' AND json_extract(m.payload_json, '$.scheduledTaskId') IS NULL
        AND COALESCE(json_extract(m.payload_json, '$.createdBy'), 'user') = 'user'
        AND json_extract(m.payload_json, '$.senderThreadId') IS NULL
      ORDER BY r.completed_at, r.run_id LIMIT 49`;
      const records = yield* decodeEvidence(rows.map((row) => ({ ...row, toolSequence: [] })));
      const candidates: Array<typeof Review.Candidate.Type> = [];
      for (const candidate of state.candidates) {
        const compact = {
          ...candidate,
          rationale: shortText(candidate.rationale, 120),
          evidenceRunIds: candidate.evidenceRunIds.slice(-2),
        };
        if (byteLength([...candidates, compact]) > 8_000) break;
        candidates.push(compact);
      }
      const packet: typeof Review.Digest.Type = {
        reviewId,
        batchId: yield* crypto.randomUUIDv4(),
        windowStart: state.cursor.at,
        windowEnd: now,
        hasMore: false,
        catalog: library.catalog,
        candidateCount: state.candidates.length,
        candidates,
        evidence: [],
        limits: { digestBytes: DIGEST_BYTES, excerptReads: 3, excerptBytes: EXCERPT_BYTES },
      };
      const evidence: Array<typeof Review.Evidence.Type> = [];
      for (const record of records.slice(0, 48)) {
        const tools = yield* sql<{
          name: string;
        }>`SELECT substr(COALESCE(json_extract(payload_json, '$.toolName'), type), 1, 64) AS name
        FROM orchestration_v2_projection_turn_items WHERE run_id = ${record.runId}
        AND type NOT IN ('user_message', 'assistant_message', 'reasoning', 'notification', 'system_notice')
        ORDER BY ordinal LIMIT 12`;
        const usage = yield* sql<{
          usage: string | null;
        }>`SELECT substr(json_extract(p.payload_json, '$.turnTokenUsage'), 1, 2000) AS usage
          FROM orchestration_v2_projection_run_attempts a JOIN orchestration_v2_projection_provider_turns p ON p.provider_turn_id = a.provider_turn_id
          WHERE a.run_id = ${record.runId} ORDER BY a.attempt_ordinal DESC LIMIT 1`;
        const latestAttemptUsage =
          usage[0]?.usage == null ? undefined : yield* decodeUsage(usage[0].usage);
        const next = {
          ...record,
          toolSequence: tools.map((tool) => tool.name),
          ...(latestAttemptUsage === undefined ? {} : { latestAttemptUsage }),
        };
        if (byteLength({ ...packet, evidence: [...evidence, next] }) > DIGEST_BYTES) break;
        evidence.push(next);
      }
      if (evidence.length === 0 && records.length > 0)
        return yield* new WorkflowReviewError({ reason: "budget" });
      const result = { ...packet, evidence, hasMore: records.length > evidence.length };
      if (byteLength(result) > DIGEST_BYTES)
        return yield* new WorkflowReviewError({ reason: "budget" });
      yield* persist(reviewId, revision, {
        ...state,
        pending: { digest: result, excerptRunIds: [] },
      });
      return result;
    },
    sql.withTransaction,
    Effect.mapError((cause) =>
      isWorkflowReviewError(cause) ? cause : new WorkflowReviewError({ reason: "storage", cause }),
    ),
  );

  const excerpt = Effect.fn("WorkflowReview.excerpt")(
    function* (input: typeof Review.ExcerptInput.Type) {
      const { state, revision, sourceFilter } = yield* load(input.reviewId);
      const pending = state.pending;
      if (pending?.digest.batchId !== input.batchId)
        return yield* new WorkflowReviewError({ reason: "stale_batch" });
      if (!pending.digest.evidence.some((item) => item.runId === input.runId))
        return yield* new WorkflowReviewError({ reason: "evidence" });
      if (!pending.excerptRunIds.includes(input.runId) && pending.excerptRunIds.length >= 3)
        return yield* new WorkflowReviewError({ reason: "excerpt_limit" });
      const rows = yield* sql<{ request: string; outcome: string }>`SELECT
      substr(json_extract(m.payload_json, '$.text'), 1, 1800) AS request,
      COALESCE((SELECT substr(json_extract(a.payload_json, '$.text'), -1800) FROM orchestration_v2_projection_messages a
        WHERE a.run_id = r.run_id AND a.role = 'assistant' AND a.streaming = 0 ORDER BY a.created_at DESC, a.message_id DESC LIMIT 1), '') AS outcome
      FROM orchestration_v2_projection_runs r JOIN orchestration_v2_projection_messages m ON m.message_id = json_extract(r.payload_json, '$.userMessageId')
      JOIN orchestration_v2_projection_threads t ON t.thread_id = r.thread_id
      JOIN projection_projects p ON p.project_id = t.project_id
      WHERE r.run_id = ${input.runId} AND t.deleted_at IS NULL AND p.deleted_at IS NULL AND ${sourceFilter}`;
      if (rows.length === 0) return yield* new WorkflowReviewError({ reason: "evidence" });
      const result = {
        runId: input.runId,
        request: shortText(rows[0]?.request ?? "", 1_800),
        outcome: shortText(rows[0]?.outcome ?? "", 1_800, true),
      };
      if (byteLength(result) > EXCERPT_BYTES)
        return yield* new WorkflowReviewError({ reason: "budget" });
      yield* persist(input.reviewId, revision, {
        ...state,
        pending: {
          ...pending,
          excerptRunIds: [...new Set([...pending.excerptRunIds, input.runId])],
        },
      });
      return result;
    },
    sql.withTransaction,
    Effect.mapError((cause) =>
      isWorkflowReviewError(cause) ? cause : new WorkflowReviewError({ reason: "storage", cause }),
    ),
  );

  const save = Effect.fn("WorkflowReview.save")(
    function* (input: typeof Review.SaveInput.Type) {
      const { now, state, revision } = yield* load(input.reviewId);
      if (input.action === "decide") {
        if (!state.candidates.some((candidate) => candidate.key === input.key))
          return yield* new WorkflowReviewError({ reason: "candidate" });
        yield* persist(input.reviewId, revision, {
          ...state,
          candidates: state.candidates.map((candidate) =>
            candidate.key === input.key
              ? { ...candidate, decision: input.decision, updatedAt: now }
              : candidate,
          ),
        });
        return { saved: true, suppressedKeys: [] };
      }
      if (state.lastBatchId === input.batchId) return { saved: true, suppressedKeys: [] };
      const pending = state.pending;
      if (pending?.digest.batchId !== input.batchId)
        return yield* new WorkflowReviewError({ reason: "stale_batch" });
      const allowedIds = new Set([
        ...pending.digest.evidence.map((item) => item.runId),
        ...state.candidates.flatMap((candidate) => candidate.evidenceRunIds),
      ]);
      const candidates = new Map(state.candidates.map((candidate) => [candidate.key, candidate]));
      const suppressedKeys: string[] = [];
      for (const proposal of input.proposals) {
        if (!proposal.evidenceRunIds.every((id) => allowedIds.has(id)))
          return yield* new WorkflowReviewError({ reason: "evidence" });
        const previous = candidates.get(proposal.key);
        if (
          previous?.decision === "accepted" ||
          (previous?.decision === "declined" &&
            previous.updatedAt >
              DateTime.formatIso(DateTime.subtract(DateTime.makeUnsafe(now), { days: 90 })))
        ) {
          suppressedKeys.push(proposal.key);
          continue;
        }
        const ids = [
          ...new Set([...(previous?.evidenceRunIds ?? []), ...proposal.evidenceRunIds]),
        ].slice(-6);
        if (proposal.stage === "proposed" && proposal.kind === "skill") {
          const independent = yield* sql<{
            thread_id: string;
          }>`SELECT DISTINCT thread_id FROM orchestration_v2_projection_runs WHERE run_id IN ${sql.in(ids)}`;
          if (independent.length < 2) return yield* new WorkflowReviewError({ reason: "evidence" });
        }
        candidates.set(proposal.key, {
          ...proposal,
          evidenceRunIds: ids,
          decision: "pending",
          updatedAt: now,
        });
      }
      const backlog = [...candidates.values()]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 60);
      const last = pending.digest.evidence.at(-1);
      yield* persist(input.reviewId, revision, {
        ...state,
        cursor: last === undefined ? state.cursor : { at: last.completedAt, runId: last.runId },
        candidates: backlog,
        pending: null,
        lastBatchId: input.batchId,
        lastReport: input.report,
      });
      return { saved: true, suppressedKeys };
    },
    sql.withTransaction,
    Effect.mapError((cause) =>
      isWorkflowReviewError(cause) ? cause : new WorkflowReviewError({ reason: "storage", cause }),
    ),
  );
  return WorkflowReview.of({ digest, excerpt, save });
});

export const layer = Layer.effect(WorkflowReview, make);
import { TurnTokenUsage } from "@t3tools/contracts";
