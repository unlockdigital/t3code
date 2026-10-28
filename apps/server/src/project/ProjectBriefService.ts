import {
  CommandId,
  ProjectBriefError,
  TextGenerationError,
  type ProjectBriefState,
  type ProjectId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import {
  collectProjectBriefSources,
  isProjectBriefContextPath,
} from "../textGeneration/ProjectBriefSources.ts";
import * as ProjectService from "./ProjectService.ts";

const emptyState: ProjectBriefState = { revision: "initial", contextFile: null, saved: null };
const isProjectBriefError = Schema.is(ProjectBriefError);
const isTextGenerationError = Schema.is(TextGenerationError);

export class ProjectBriefService extends Context.Service<
  ProjectBriefService,
  {
    readonly get: (projectId: ProjectId) => Effect.Effect<ProjectBriefState, ProjectBriefError>;
    readonly generate: (
      projectId: ProjectId,
    ) => Effect.Effect<ProjectBriefState, ProjectBriefError | TextGenerationError>;
    readonly clear: (projectId: ProjectId) => Effect.Effect<ProjectBriefState, ProjectBriefError>;
    readonly configure: (
      projectId: ProjectId,
      contextFile: string | null,
    ) => Effect.Effect<ProjectBriefState, ProjectBriefError>;
  }
>()("t3/project/ProjectBriefService") {}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const projectService = yield* ProjectService.ProjectService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const generation = yield* TextGeneration.TextGeneration;
  const sourceContext =
    yield* Effect.context<Effect.Services<ReturnType<typeof collectProjectBriefSources>>>();
  const locks = yield* KeyedLock.make<ProjectId>();
  const pending = new Map<
    ProjectId,
    {
      readonly revision: string;
      readonly run: Effect.Effect<ProjectBriefState, ProjectBriefError | TextGenerationError>;
    }
  >();

  const readProject = Effect.fn("ProjectBriefService.readProject")(function* (
    projectId: ProjectId,
  ) {
    const project = yield* projects
      .get(projectId)
      .pipe(Effect.mapError((cause) => new ProjectBriefError({ reason: "storage-failed", cause })));
    if (Option.isNone(project)) return yield* new ProjectBriefError({ reason: "missing-project" });
    return project.value;
  });
  const get = Effect.fn("ProjectBriefService.get")(function* (projectId: ProjectId) {
    return (yield* readProject(projectId)).briefState ?? emptyState;
  });
  const save = Effect.fn("ProjectBriefService.save")(function* (
    projectId: ProjectId,
    expectedRevision: string,
    state: ProjectBriefState,
  ) {
    yield* projectService
      .updateBrief({
        projectId,
        commandId: CommandId.make(yield* crypto.randomUUIDv4().pipe(Effect.orDie)),
        expectedRevision,
        state,
      })
      .pipe(Effect.mapError((cause) => new ProjectBriefError({ reason: "storage-failed", cause })));
    return state;
  });
  const replace = Effect.fn("ProjectBriefService.replace")(function* (
    projectId: ProjectId,
    contextFile: string | null | undefined,
  ) {
    return yield* locks.withLock(
      projectId,
      Effect.gen(function* () {
        const current = yield* get(projectId);
        const next = {
          revision: yield* crypto.randomUUIDv4().pipe(Effect.orDie),
          contextFile: contextFile === undefined ? current.contextFile : contextFile,
          saved: null,
        };
        const result = yield* save(projectId, current.revision, next);
        pending.delete(projectId);
        return result;
      }),
    );
  });
  const configure = Effect.fn("ProjectBriefService.configure")(function* (
    projectId: ProjectId,
    contextFile: string | null,
  ) {
    if (
      contextFile !== null &&
      (contextFile.length > 512 || !isProjectBriefContextPath(contextFile))
    ) {
      return yield* new ProjectBriefError({ reason: "invalid-context" });
    }
    return yield* replace(projectId, contextFile);
  });

  const generate = Effect.fn("ProjectBriefService.generate")(function* (projectId: ProjectId) {
    const run = yield* locks.withLock(
      projectId,
      Effect.gen(function* () {
        const project = yield* readProject(projectId);
        const state = project.briefState ?? emptyState;
        const existing = pending.get(projectId);
        if (existing?.revision === state.revision) return existing.run;
        const revision = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
        const started = { ...state, revision };
        yield* save(projectId, state.revision, started);
        const operation = Effect.gen(function* () {
          const selected = resolveProjectSettings(yield* settings.getSettings, projectId).settings
            .textGenerationModelSelection;
          const sources = yield* collectProjectBriefSources(
            project.workspaceRoot,
            state.contextFile ?? undefined,
          ).pipe(Effect.provide(sourceContext));
          const result = yield* generation.generateProjectBrief({
            projectId,
            cwd: sources.canonicalRoot,
            sourceText: sources.text,
            modelSelection: selected,
          });
          if (!result.text.trim() || Array.from(result.text).length > 500) {
            return yield* new ProjectBriefError({ reason: "generation-failed" });
          }
          return yield* locks.withLock(
            projectId,
            Effect.gen(function* () {
              const current = yield* readProject(projectId);
              if (
                current.workspaceRoot !== project.workspaceRoot ||
                current.briefState?.revision !== revision
              ) {
                return yield* new ProjectBriefError({ reason: "stale" });
              }
              return yield* save(projectId, revision, {
                ...started,
                saved: {
                  text: result.text,
                  generatedAt: DateTime.formatIso(yield* DateTime.now),
                  sources: sources.sources,
                  modelSelection: result.modelSelection ?? selected,
                },
              });
            }),
          );
        }).pipe(
          Effect.mapError((cause) =>
            isProjectBriefError(cause) || isTextGenerationError(cause)
              ? cause
              : new ProjectBriefError({ reason: "generation-failed", cause }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              if (pending.get(projectId)?.revision === revision) pending.delete(projectId);
            }),
          ),
        );
        const cached = yield* Effect.cached(operation);
        pending.set(projectId, { revision, run: cached });
        return cached;
      }),
    );
    return yield* run;
  });
  return ProjectBriefService.of({
    get,
    generate,
    clear: (projectId) => replace(projectId, undefined),
    configure,
  });
});

export const layer = Layer.effect(ProjectBriefService, make);
