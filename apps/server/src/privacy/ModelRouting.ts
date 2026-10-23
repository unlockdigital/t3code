import {
  type ModelSelection,
  type OrchestrationV2AppThread,
  type PrivateModelRoute,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerSettings from "../serverSettings.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import {
  isModelRoutingError,
  isPrivateInferenceSelection,
  ModelRoutingError,
  projectRequiresPrivateModels,
  requiredPrivateRoute,
  validatePrivateRoute,
} from "./modelRoutingPolicy.ts";

export interface ModelRequestContext {
  readonly cwd: string;
  readonly threadId?: ThreadId;
  readonly projectId?: ProjectId;
}

export class ModelRouting extends Context.Service<
  ModelRouting,
  {
    readonly backgroundModel: (
      input: ModelRequestContext & {
        readonly modelSelection: ModelSelection;
        readonly thread?: OrchestrationV2AppThread;
      },
    ) => Effect.Effect<
      { readonly modelSelection: ModelSelection; readonly private: boolean },
      ModelRoutingError
    >;
  }
>()("t3/privacy/ModelRouting") {}

export const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const threads = yield* ProjectionStore.ProjectionStoreV2;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const contains = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return (
      relative === "" ||
      (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
    );
  };
  const canonical = (value: string) => fs.realPath(path.resolve(value));
  const canonicalRoot = (value: string) =>
    canonical(value).pipe(
      Effect.catch((cause) =>
        cause.reason._tag === "NotFound" ? Effect.succeed(path.resolve(value)) : Effect.fail(cause),
      ),
    );

  return ModelRouting.of({
    backgroundModel: Effect.fn("ModelRouting.backgroundModel")(
      function* (input) {
        const settings = yield* settingsService.getRoutingSettings;
        const routes: Array<{ route: PrivateModelRoute; projectId: ProjectId | null }> = [];
        if (
          settings.modelPrivacy === "private" &&
          input.threadId === undefined &&
          input.projectId === undefined
        ) {
          if (settings.privateModelRoute === null)
            return yield* new ModelRoutingError({ reason: "setup-required" });
          routes.push({ route: settings.privateModelRoute, projectId: null });
        }
        const routeKeys = new Set<string>();
        // The request span covers each matching workspace root.
        const add = Effect.fnUntraced(function* (projectId: ProjectId, route?: PrivateModelRoute) {
          const required = requiredPrivateRoute(settings, {
            projectId,
            ...(route === undefined ? {} : { privateModelRoute: route }),
          });
          if (required === undefined)
            return yield* new ModelRoutingError({ reason: "setup-required" });
          if (required !== null) {
            const key = `${projectId}:${required.modelSelection.instanceId}:${required.providerConfigHash}`;
            if (!routeKeys.has(key)) {
              routes.push({ route: required, projectId });
              routeKeys.add(key);
            }
          }
        });
        if (input.threadId !== undefined) {
          const thread =
            input.thread?.id === input.threadId
              ? input.thread
              : yield* threads.getThread(input.threadId);
          const connectorRoute = isPrivateInferenceSelection(settings, thread.modelSelection)
            ? settings.privateModelRoute
            : null;
          if (
            thread.privateModelRoute === undefined &&
            isPrivateInferenceSelection(settings, thread.modelSelection) &&
            connectorRoute === null
          )
            return yield* new ModelRoutingError({ reason: "setup-required" });
          yield* add(thread.projectId, thread.privateModelRoute ?? connectorRoute ?? undefined);
          if (input.projectId !== undefined && input.projectId !== thread.projectId)
            return yield* new ModelRoutingError({ reason: "context-unavailable" });
          // An explicit Standard thread keeps its own policy when a private sibling shares files.
          if (routes.length === 0) return { modelSelection: input.modelSelection, private: false };
        } else if (input.projectId !== undefined) yield* add(input.projectId);

        // Resolve aliases and registered worktrees as well as the caller's explicit context.
        // A context-free Git action sharing private files takes the conservative private route.
        const privateThreads = yield* threads.getPrivateModelRoutingThreads;
        if (
          routes.length === 0 &&
          privateThreads.length === 0 &&
          settings.modelPrivacy === "standard" &&
          !Object.values(settings.projectSettingsOverrides).some(
            (project) => project.modelPrivacy === "private",
          )
        )
          return { modelSelection: input.modelSelection, private: false };
        const allProjects = yield* projects.list({ includeDeleted: true });
        const privateProjectIds = new Set(privateThreads.map((thread) => thread.projectId));
        const protectedProjects = allProjects.filter(
          (project) =>
            projectRequiresPrivateModels(settings, project.projectId) ||
            privateProjectIds.has(project.projectId),
        );
        const roots = new Map<string, string>();
        const resolveRoot = (root: string) =>
          roots.has(root)
            ? Effect.succeed(roots.get(root)!)
            : canonicalRoot(root).pipe(
                Effect.tap((resolved) =>
                  Effect.sync(() => {
                    roots.set(root, resolved);
                  }),
                ),
              );
        if (protectedProjects.length > 0 || privateThreads.length > 0) {
          const cwd = yield* canonical(input.cwd);
          for (const project of protectedProjects) {
            const root = yield* resolveRoot(project.workspaceRoot);
            if (!contains(root, cwd)) continue;
            yield* add(project.projectId);
            for (const thread of privateThreads.filter(
              (thread) => thread.projectId === project.projectId && thread.worktreePath === null,
            ))
              yield* add(thread.projectId, thread.privateModelRoute);
          }
          for (const thread of privateThreads) {
            const threadRoots = new Set([
              ...(thread.privateWorkspacePaths ?? []),
              ...(thread.worktreePath === null ? [] : [thread.worktreePath]),
            ]);
            for (const root of threadRoots)
              if (contains(yield* resolveRoot(root), cwd)) {
                yield* add(thread.projectId, thread.privateModelRoute);
                break;
              }
          }
        }
        if (routes.length === 0) return { modelSelection: input.modelSelection, private: false };
        const first = routes[0]!;
        for (const candidate of routes) {
          yield* validatePrivateRoute(settings, candidate.route, candidate.projectId);
          if (
            candidate.route.modelSelection.instanceId !== first.route.modelSelection.instanceId ||
            candidate.route.providerConfigHash !== first.route.providerConfigHash
          )
            return yield* new ModelRoutingError({ reason: "destination-blocked" });
        }
        return { modelSelection: first.route.modelSelection, private: true };
      },
      Effect.catch((cause) =>
        Effect.fail(
          isModelRoutingError(cause)
            ? cause
            : new ModelRoutingError({ reason: "context-unavailable", cause }),
        ),
      ),
    ),
  });
});

export const layer = Layer.effect(ModelRouting, make).pipe(
  Layer.provide(Layer.merge(ProjectStore.layer, ProjectionStore.layer)),
);
