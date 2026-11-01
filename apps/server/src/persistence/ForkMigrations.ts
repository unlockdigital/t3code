import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";
import WorkflowReviews from "./forkMigrations/WorkflowReviews.ts";
import ProjectBrief from "./forkMigrations/ProjectBrief.ts";
import ShellStopRequestIndex from "./Migrations/068_ShellStopRequestIndex.ts";
import ThreadMessageSearch from "./Migrations/069_ThreadMessageSearch.ts";

export const isLegacyForkMigration = (id: number, name: string | undefined): boolean =>
  (id === 68 && name === "WorkflowReviews") || (id === 69 && name === "ProjectBrief");

const badState = (detail: string) =>
  new Migrator.MigrationError({
    kind: "BadState",
    message: `Fork schema compatibility check failed: ${detail}`,
  });

const tableColumns = Effect.fn("ForkMigrations.tableColumns")(function* (table: string) {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{ readonly name: string }>`SELECT name FROM pragma_table_info(${table})`;
});

const validateWorkflowReviews = Effect.gen(function* () {
  const columns = new Set((yield* tableColumns("workflow_reviews")).map((row) => row.name));
  if (!["review_id", "revision", "payload_json"].every((name) => columns.has(name)))
    return yield* badState("WorkflowReviews was recorded without the expected table columns.");
});

const hasBriefColumn = tableColumns("projection_projects").pipe(
  Effect.map((rows) => rows.some((row) => row.name === "brief_state_json")),
);

const ledger = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS unlock_digital_schema_migrations (
    name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;
  return <E, R>(name: string, migration: Effect.Effect<void, E, R>) =>
    Effect.gen(function* () {
      const recorded =
        yield* sql`SELECT name FROM unlock_digital_schema_migrations WHERE name=${name}`;
      if (recorded.length > 0) return;
      yield* migration;
      yield* sql`INSERT INTO unlock_digital_schema_migrations(name) VALUES(${name})`;
    });
});

// Historical fork ids remain intact; a separate ledger avoids future upstream id collisions.
export const bridgeLegacyForkMigrations = Effect.fn("ForkMigrations.bridgeLegacy")(function* (
  throughId?: number,
) {
  if (throughId !== undefined && throughId < 68) return;
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql`SELECT name FROM sqlite_master WHERE name='effect_sql_migrations'`;
  if (tables.length === 0) return;
  const rows = yield* sql<{
    readonly migration_id: number;
    readonly name: string;
  }>`SELECT migration_id,name FROM effect_sql_migrations WHERE migration_id IN (68,69)`;
  const workflow = rows.some((row) => row.migration_id === 68 && row.name === "WorkflowReviews");
  const brief =
    (throughId === undefined || throughId >= 69) &&
    rows.some((row) => row.migration_id === 69 && row.name === "ProjectBrief");
  if (!workflow && !brief) return;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      if (workflow) yield* validateWorkflowReviews;
      if (brief && !(yield* hasBriefColumn))
        return yield* badState("ProjectBrief was recorded without brief_state_json.");
      const once = yield* ledger;
      if (workflow)
        yield* once(
          "upstream-68-ShellStopRequestIndex",
          Effect.gen(function* () {
            const index =
              yield* sql`SELECT name FROM sqlite_master WHERE name='orchestration_v2_projection_turn_items_stop_request_idx'`;
            if (index.length === 0) yield* ShellStopRequestIndex;
          }),
        );
      if (brief)
        yield* once(
          "upstream-69-ThreadMessageSearch",
          Effect.gen(function* () {
            const index =
              yield* sql`SELECT name FROM sqlite_master WHERE name='orchestration_v2_message_search'`;
            if (index.length === 0) yield* ThreadMessageSearch;
          }),
        );
    }),
  );
});

export const ensureForkMigrations = Effect.fn("ForkMigrations.ensure")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      const once = yield* ledger;
      yield* once(
        "WorkflowReviews",
        Effect.gen(function* () {
          const columns = yield* tableColumns("workflow_reviews");
          if (columns.length === 0) yield* WorkflowReviews;
          else yield* validateWorkflowReviews;
        }),
      );
      yield* once(
        "ProjectBrief",
        Effect.gen(function* () {
          if (!(yield* hasBriefColumn)) yield* ProjectBrief;
        }),
      );
    }),
  );
});
