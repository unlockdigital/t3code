import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  type ProjectScript,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";

import {
  planProjectCommand,
  type ProjectCommand,
  type ProjectCommandState,
} from "./ProjectCommands.ts";
import type { ProjectRow } from "./ProjectStore.ts";

const now = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");
const projectId = ProjectId.make("project-scripts");

const row = (overrides: Partial<ProjectRow> = {}): ProjectRow => ({
  projectId,
  title: "Scripts",
  workspaceRoot: "/tmp/scripts",
  defaultModelSelection: null,
  defaultThreadEnvMode: null,
  autoPull: false,
  faviconPath: null,
  projectIcon: null,
  scripts: [],
  pinnedAt: null,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  ...overrides,
});

const script = (id: string): ProjectScript => ({
  id,
  name: "Install dependencies",
  command: "vp i",
  icon: "configure",
  runOnWorktreeCreate: false,
});

const plan = (command: ProjectCommand, state: Partial<ProjectCommandState> = {}) =>
  planProjectCommand({
    command,
    state: { project: undefined, workspaceOwner: undefined, ...state },
    eventId: EventId.make("event:planned"),
    now,
  });

const payloadOf = (result: ReturnType<typeof plan>) => {
  assert.isTrue(Result.isSuccess(result));
  return Result.getOrThrow(result).payload as Record<string, unknown>;
};

const failureOf = (result: ReturnType<typeof plan>) => {
  assert.isTrue(Result.isFailure(result));
  return Result.isFailure(result) ? result.failure : assert.fail("expected a rejection");
};

describe("planProjectCommand", () => {
  it("invalidates saved briefs on workspace moves and rejects stale completions", () => {
    const briefState = {
      revision: "request-1",
      contextFile: "mission.md",
      saved: {
        text: "A documented mission.",
        generatedAt: "2026-01-01T00:00:00.000Z",
        sources: ["README.md"],
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
      },
    };
    const command = {
      type: "project.meta.update" as const,
      commandId: CommandId.make("cmd-brief"),
      projectId,
    };
    assert.deepEqual(
      payloadOf(plan({ ...command, workspaceRoot: "/new-root" }, { project: row({ briefState }) }))
        .briefState,
      { revision: "event:planned", contextFile: null, saved: null },
    );
    assert.equal(
      failureOf(
        plan(
          { ...command, briefState, expectedBriefRevision: "request-1" },
          {
            project: row({ briefState: { ...briefState, revision: "cleared" } }),
          },
        ),
      )._tag,
      "ProjectCommandInvariantError",
    );
    assert.equal(
      failureOf(
        plan(
          { ...command, briefState, expectedBriefRevision: "request-1" },
          {
            project: row({ briefState, deletedAt: "2026-01-01T00:00:00.000Z" }),
          },
        ),
      )._tag,
      "ProjectCommandMissingProjectError",
    );
    assert.deepEqual(
      payloadOf(
        plan(
          { ...command, briefState, expectedBriefRevision: "request-1" },
          {
            project: row({ briefState }),
          },
        ),
      ).briefState,
      briefState,
    );
  });

  it("bounds brief output by Unicode code points", () => {
    const command = {
      type: "project.meta.update" as const,
      commandId: CommandId.make("cmd-brief-size"),
      projectId,
    };
    const saved = {
      text: "😀".repeat(500),
      generatedAt: "2026-01-01T00:00:00.000Z",
      sources: ["README.md"],
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
    };
    const briefState = { revision: "new", contextFile: null, saved };
    assert.deepEqual(
      payloadOf(plan({ ...command, briefState }, { project: row() })).briefState,
      briefState,
    );
    assert.equal(
      failureOf(
        plan(
          {
            ...command,
            briefState: { ...briefState, saved: { ...saved, text: saved.text + "x" } },
          },
          { project: row() },
        ),
      )._tag,
      "ProjectCommandInvariantError",
    );
  });

  it("keeps legacy scripts editable and removable while rejecting new invalid ones", () => {
    const legacy = script("install-javascript-dependencies");
    const withLegacy = (scripts: ReadonlyArray<ProjectScript>) =>
      plan(
        {
          type: "project.meta.update",
          commandId: CommandId.make("cmd-repair-script"),
          projectId,
          scripts,
        },
        { project: row({ scripts: [legacy] }) },
      );
    for (const scripts of [[{ ...legacy, command: "vp install" }, script("lint")], []]) {
      assert.deepEqual(payloadOf(withLegacy(scripts)).scripts, scripts);
    }
    assert.equal(
      failureOf(withLegacy([legacy, script("another.invalid.id")]))._tag,
      "ProjectCommandInvariantError",
    );
  });

  it("keeps the first pin and archive time, and clears both on undo", () => {
    const earlier = "2025-12-01T00:00:00.000Z";
    const update = (project: ProjectRow, change: { pinned?: boolean; archived?: boolean }) =>
      payloadOf(
        plan(
          {
            type: "project.meta.update",
            commandId: CommandId.make("cmd-organize"),
            projectId,
            ...change,
          },
          { project },
        ),
      );
    assert.deepInclude(update(row(), { pinned: true, archived: true }), {
      pinnedAt: "2026-01-01T00:00:00.000Z",
      archivedAt: "2026-01-01T00:00:00.000Z",
    });
    const organized = row({ pinnedAt: earlier, archivedAt: earlier });
    assert.deepInclude(update(organized, { pinned: true, archived: true }), {
      pinnedAt: earlier,
      archivedAt: earlier,
    });
    assert.deepInclude(update(organized, { pinned: false, archived: false }), {
      pinnedAt: null,
      archivedAt: null,
    });
    const untouched = update(organized, {});
    assert.notProperty(untouched, "pinnedAt");
    assert.notProperty(untouched, "archivedAt");
  });

  it("rejects a workspace root held by another active project", () => {
    const owner = row({
      projectId: ProjectId.make("project-existing"),
      workspaceRoot: "/tmp/project",
    });
    const create = failureOf(
      plan(
        {
          type: "project.create",
          commandId: CommandId.make("cmd-duplicate-root"),
          projectId: ProjectId.make("project-duplicate-root"),
          title: "Duplicate",
          workspaceRoot: "/tmp/project",
        },
        { workspaceOwner: owner },
      ),
    );
    assert.equal(create._tag, "ProjectWorkspaceConflictError");
    assert.equal(
      create.message,
      "Active project 'project-existing' already exists for workspace root '/tmp/project'.",
    );
    const move = failureOf(
      plan(
        {
          type: "project.meta.update",
          commandId: CommandId.make("cmd-move-root"),
          projectId,
          workspaceRoot: "/tmp/project",
        },
        { project: row(), workspaceOwner: owner },
      ),
    );
    assert.equal(move._tag, "ProjectWorkspaceConflictError");
  });

  it("requires the project to exist, and to be absent on create", () => {
    const create: ProjectCommand = {
      type: "project.create",
      commandId: CommandId.make("cmd-create-twice"),
      projectId,
      title: "Twice",
      workspaceRoot: "/tmp/twice",
    };
    assert.include(failureOf(plan(create, { project: row() })).message, "cannot be created twice");
    const deleted = row({ deletedAt: "2026-01-01T00:00:00.000Z" });
    assert.include(
      failureOf(plan(create, { project: deleted })).message,
      "cannot be created twice",
    );
    for (const command of [
      { type: "project.meta.update", commandId: CommandId.make("cmd-missing"), projectId },
      { type: "project.delete", commandId: CommandId.make("cmd-missing"), projectId },
    ] as const) {
      for (const project of [undefined, deleted]) {
        assert.equal(
          failureOf(plan(command, { project }))._tag,
          "ProjectCommandMissingProjectError",
        );
      }
    }
  });
});
