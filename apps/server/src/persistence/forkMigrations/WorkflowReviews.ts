import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE workflow_reviews (
    review_id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL,
    payload_json TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX orchestration_v2_runs_review_idx
    ON orchestration_v2_projection_runs(completed_at, run_id)
    WHERE status IN ('completed', 'failed', 'cancelled', 'interrupted')`;
});
