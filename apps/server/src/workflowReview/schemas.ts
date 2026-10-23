import { RunId, ThreadId, TurnTokenUsage } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const boundedText = (max: number) =>
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max));
export const ReviewId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/));
export const DigestInput = Schema.Struct({ reviewId: ReviewId });
export const Evidence = Schema.Struct({
  runId: RunId,
  threadId: ThreadId,
  projectId: Schema.String,
  title: Schema.String,
  completedAt: Schema.String,
  status: Schema.String,
  request: Schema.String,
  outcome: Schema.String,
  toolSequence: Schema.Array(Schema.String),
  latestAttemptUsage: Schema.optional(TurnTokenUsage),
});
export const Proposal = Schema.Struct({
  key: ReviewId,
  kind: Schema.Literals(["skill", "improve_skill", "helper", "ide_feature"]),
  title: boundedText(100),
  trigger: boundedText(180),
  rationale: boundedText(400),
  confidence: Schema.Literals(["low", "medium", "high"]),
  stage: Schema.Literals(["watching", "proposed"]),
  evidenceRunIds: Schema.Array(RunId).check(Schema.isMinLength(1), Schema.isMaxLength(6)),
});
export const Candidate = Schema.Struct({
  ...Proposal.fields,
  decision: Schema.Literals(["pending", "accepted", "declined"]),
  updatedAt: Schema.String,
});
export const Digest = Schema.Struct({
  reviewId: ReviewId,
  batchId: Schema.String,
  windowStart: Schema.String,
  windowEnd: Schema.String,
  hasMore: Schema.Boolean,
  catalog: Schema.String,
  candidateCount: Schema.Number,
  candidates: Schema.Array(Candidate),
  evidence: Schema.Array(Evidence),
  limits: Schema.Struct({
    digestBytes: Schema.Number,
    excerptReads: Schema.Number,
    excerptBytes: Schema.Number,
  }),
});
export const ExcerptInput = Schema.Struct({
  reviewId: ReviewId,
  batchId: Schema.String,
  runId: RunId,
});
export const Excerpt = Schema.Struct({
  runId: RunId,
  request: Schema.String,
  outcome: Schema.String,
});
export const CompleteInput = Schema.Struct({
  reviewId: ReviewId,
  batchId: Schema.String,
  report: boundedText(4_000),
  proposals: Schema.Array(Proposal).check(Schema.isMaxLength(3)),
});
export const DecisionInput = Schema.Struct({
  reviewId: ReviewId,
  key: ReviewId,
  decision: Schema.Literals(["accepted", "declined"]),
});
export const SaveInput = Schema.Union([
  Schema.Struct({ action: Schema.Literal("complete"), ...CompleteInput.fields }),
  Schema.Struct({ action: Schema.Literal("decide"), ...DecisionInput.fields }),
]);
export const SaveResult = Schema.Struct({
  saved: Schema.Boolean,
  suppressedKeys: Schema.Array(Schema.String),
});

export const State = Schema.Struct({
  cursor: Schema.Struct({ at: Schema.String, runId: Schema.String }),
  candidates: Schema.Array(Candidate).check(Schema.isMaxLength(60)),
  pending: Schema.NullOr(
    Schema.Struct({
      digest: Digest,
      excerptRunIds: Schema.Array(RunId),
    }),
  ),
  lastBatchId: Schema.NullOr(Schema.String),
  lastReport: Schema.NullOr(Schema.String),
});
