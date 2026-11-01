import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as SqlClient from "effect/sql/SqlClient";
import { runMigrations } from "./Migrations.ts";
import WorkflowReviews from "./forkMigrations/WorkflowReviews.ts";
import ProjectBrief from "./forkMigrations/ProjectBrief.ts";

const assertCustomSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`SELECT review_id, revision, payload_json FROM workflow_reviews LIMIT 0`;
  yield* sql`SELECT brief_state_json FROM projection_projects LIMIT 0`;
});

it.effect.each([0, 68, 69, 76])(
  "preserves fork data from history %s and restarts idempotently",
  (history) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      if (history === 68 || history === 69) {
        yield* runMigrations({ toMigrationInclusive: 67 });
        yield* WorkflowReviews;
        yield* sql`INSERT INTO effect_sql_migrations(migration_id,name) VALUES(68,'WorkflowReviews')`;
        yield* sql`INSERT INTO workflow_reviews VALUES('synthetic-review', 7, '{"test":true}')`;
        if (history === 69) {
          yield* ProjectBrief;
          yield* sql`INSERT INTO effect_sql_migrations(migration_id,name) VALUES(69,'ProjectBrief')`;
        }
      } else if (history === 76) {
        yield* runMigrations({ toMigrationInclusive: 76 });
      }
      yield* runMigrations();
      yield* assertCustomSchema;
      const indexes =
        yield* sql`SELECT name FROM sqlite_master WHERE name='orchestration_v2_projection_turn_items_stop_request_idx'`;
      assert.lengthOf(indexes, 1);
      const before =
        yield* sql`SELECT migration_id,name FROM effect_sql_migrations ORDER BY migration_id`;
      assert.deepStrictEqual(yield* runMigrations(), []);
      assert.deepStrictEqual(
        yield* sql`SELECT migration_id,name FROM effect_sql_migrations ORDER BY migration_id`,
        before,
      );
      if (history === 68 || history === 69) {
        assert.deepStrictEqual(yield* sql`SELECT revision,payload_json FROM workflow_reviews`, [
          { revision: 7, payload_json: '{"test":true}' },
        ]);
        assert.equal(before.find((row) => row.migration_id === 68)?.name, "WorkflowReviews");
      }
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

it.effect("refuses a fork migration label without its schema", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 67 });
    yield* sql`INSERT INTO effect_sql_migrations(migration_id,name) VALUES(68,'WorkflowReviews')`;
    assert.isTrue(Exit.isFailure(yield* Effect.exit(runMigrations())));
    assert.lengthOf(yield* sql`SELECT name FROM sqlite_master WHERE name='peer_links'`, 0);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
