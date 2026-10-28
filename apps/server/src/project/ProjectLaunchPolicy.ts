import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

export const FILE_NAME = "project-launch-policy.json";

export interface ProjectLaunchPolicy {
  readonly protectedProjectIds: ReadonlySet<string>;
  readonly allowedTargetProjectIds: ReadonlySet<string>;
}

export type ProjectLaunchPolicyError = "unavailable" | "invalid";

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const isProjectIdList = (value: unknown): value is Array<string> =>
  Array.isArray(value) &&
  value.every((entry) => typeof entry === "string" && entry.length > 0 && entry.trim() === entry);

export const decode = (value: unknown): ProjectLaunchPolicy | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    !isProjectIdList(record.protectedProjectIds) ||
    !isProjectIdList(record.allowedTargetProjectIds) ||
    new Set(record.protectedProjectIds).size !== record.protectedProjectIds.length ||
    new Set(record.allowedTargetProjectIds).size !== record.allowedTargetProjectIds.length
  )
    return undefined;
  return {
    protectedProjectIds: new Set(record.protectedProjectIds),
    allowedTargetProjectIds: new Set(record.allowedTargetProjectIds),
  };
};

/** Missing policy means a clean installation has no personal launch restriction. */
export const read = Effect.fn("ProjectLaunchPolicy.read")(function* (stateDir: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const policyPath = `${stateDir.replace(/[\\/]+$/, "")}/${FILE_NAME}`;
  const exists = yield* fileSystem
    .exists(policyPath)
    .pipe(Effect.mapError((): ProjectLaunchPolicyError => "unavailable"));
  if (!exists) return undefined;

  const source = yield* fileSystem
    .readFileString(policyPath)
    .pipe(Effect.mapError((): ProjectLaunchPolicyError => "unavailable"));
  const parsed = yield* decodeJson(source).pipe(
    Effect.mapError((): ProjectLaunchPolicyError => "invalid"),
  );
  const policy = decode(parsed);
  if (policy === undefined) return yield* Effect.fail<ProjectLaunchPolicyError>("invalid");
  return policy;
});
