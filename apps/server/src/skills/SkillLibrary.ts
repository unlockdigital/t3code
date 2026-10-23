import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { parseSkillFrontmatter } from "./skillFrontmatter.ts";

import * as ServerConfig from "../config.ts";

const Entry = Schema.Struct({
  name: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,79}$/)),
  description: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(240)),
  path: Schema.String,
  workingDirectory: Schema.optionalKey(Schema.String),
  mode: Schema.optionalKey(Schema.Literals(["auto", "manual", "disabled"])),
});
const Manifest = Schema.Struct({ skills: Schema.Array(Entry).check(Schema.isMaxLength(64)) });
const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest));
const catalogText = (entries: ReadonlyArray<typeof Entry.Type>) =>
  entries
    .filter((entry) => entry.mode !== "disabled")
    .toSorted((a, b) => a.name.localeCompare(b.name, "en"))
    .map(
      (entry) =>
        `${entry.name}${entry.mode === "manual" ? " [explicit request]" : ""}: ${entry.description.replaceAll(/\s+/g, " ").trim()}`,
    )
    .join("\n");

export class SkillLibraryError extends Schema.TaggedError<SkillLibraryError>()(
  "SkillLibraryError",
  {
    reason: Schema.Literals([
      "configuration",
      "unknown_skill",
      "manual_only",
      "path",
      "size",
      "read",
    ]),
  },
) {
  override get message() {
    return `Skill library could not load the requested content (${this.reason}).`;
  }
}

export const SkillReadInput = Schema.Struct({
  name: Schema.String,
  resource: Schema.optionalKey(Schema.String),
  retainedVersion: Schema.optionalKey(Schema.String),
  explicitInvocation: Schema.optionalKey(Schema.Boolean),
});
export const SkillReadResult = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  baseDirectory: Schema.String,
  workingDirectory: Schema.optionalKey(Schema.String),
  version: Schema.String,
  unchanged: Schema.Boolean,
  content: Schema.String,
});

export class SkillLibrary extends Context.Service<
  SkillLibrary,
  {
    readonly catalog: string;
    readonly read: (
      input: typeof SkillReadInput.Type,
    ) => Effect.Effect<typeof SkillReadResult.Type, SkillLibraryError>;
  }
>()("t3/skills/SkillLibrary") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const crypto = yield* Crypto.Crypto;
  const manifestPath = path.join(config.stateDir, "skills.json");
  // Bounded reads also cover a file growing between stat and read. Core instructions
  // are returned whole; oversized resources stay accessible through native file tools.
  const readText = Effect.fn("SkillLibrary.readText")(function* (file: string, limit: number) {
    const stat = yield* fs
      .stat(file)
      .pipe(Effect.mapError(() => new SkillLibraryError({ reason: "read" })));
    if (stat.type !== "File") return yield* new SkillLibraryError({ reason: "path" });
    const bytes = yield* fs.stream(file, { bytesToRead: limit + 1 }).pipe(
      Stream.runFold(
        () => new Uint8Array(),
        (previous, chunk) => {
          const result = new Uint8Array(previous.length + chunk.length);
          result.set(previous);
          result.set(chunk, previous.length);
          return result;
        },
      ),
      Effect.mapError(() => new SkillLibraryError({ reason: "read" })),
    );
    if (bytes.length > limit) return yield* new SkillLibraryError({ reason: "size" });
    return yield* Effect.try({
      try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      catch: () => new SkillLibraryError({ reason: "read" }),
    });
  });
  const manifest = yield* Effect.gen(function* () {
    if (!(yield* fs.exists(manifestPath))) return { skills: [] };
    const parsed = yield* readText(manifestPath, 32_768).pipe(Effect.flatMap(decodeManifest));
    const names = new Set<string>();
    for (const entry of parsed.skills) {
      if (
        names.has(entry.name) ||
        !path.isAbsolute(entry.path) ||
        path.basename(entry.path) !== "SKILL.md" ||
        (entry.workingDirectory !== undefined && !path.isAbsolute(entry.workingDirectory))
      ) {
        return yield* new SkillLibraryError({ reason: "configuration" });
      }
      names.add(entry.name);
    }
    if (new TextEncoder().encode(catalogText(parsed.skills)).length > 8_192) {
      return yield* new SkillLibraryError({ reason: "size" });
    }
    return parsed;
  }).pipe(
    Effect.catch(() =>
      Effect.logWarning("Skill library configuration is invalid; check userdata/skills.json.").pipe(
        Effect.as({ skills: [] }),
      ),
    ),
  );
  const entries = new Map(
    manifest.skills
      .filter((entry) => entry.mode !== "disabled")
      .map((entry) => [entry.name, entry]),
  );
  const catalog = catalogText([...entries.values()]);

  const read = Effect.fn("SkillLibrary.read")(function* (input: typeof SkillReadInput.Type) {
    const entry = entries.get(input.name);
    if (entry === undefined) return yield* new SkillLibraryError({ reason: "unknown_skill" });
    if (entry.mode === "manual" && input.explicitInvocation !== true)
      return yield* new SkillLibraryError({ reason: "manual_only" });
    const baseDirectory = yield* fs
      .realPath(path.dirname(entry.path))
      .pipe(Effect.mapError(() => new SkillLibraryError({ reason: "read" })));
    const resource = input.resource ?? "SKILL.md";
    if (path.isAbsolute(resource)) return yield* new SkillLibraryError({ reason: "path" });
    const target = yield* fs
      .realPath(path.resolve(baseDirectory, resource))
      .pipe(Effect.mapError(() => new SkillLibraryError({ reason: "read" })));
    const relative = path.relative(baseDirectory, target);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      return yield* new SkillLibraryError({ reason: "path" });
    const corePath = yield* fs
      .realPath(entry.path)
      .pipe(Effect.mapError(() => new SkillLibraryError({ reason: "read" })));
    if (path.dirname(corePath) !== baseDirectory)
      return yield* new SkillLibraryError({ reason: "path" });
    const core = yield* readText(corePath, 32_768);
    // Recheck source policy on every activation; manifest metadata is a startup snapshot.
    const metadata = parseSkillFrontmatter(core);
    if (metadata.kind === "malformed")
      return yield* new SkillLibraryError({ reason: "configuration" });
    if (
      metadata.kind === "parsed" &&
      metadata.userInvocationOnly &&
      input.explicitInvocation !== true
    ) {
      return yield* new SkillLibraryError({ reason: "manual_only" });
    }
    const content = target === corePath ? core : yield* readText(target, 16_384);
    const digest = yield* crypto
      .digest("SHA-256", new TextEncoder().encode(content))
      .pipe(Effect.mapError(() => new SkillLibraryError({ reason: "read" })));
    const version = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const unchanged = input.retainedVersion === version;
    return {
      name: entry.name,
      path: target,
      baseDirectory,
      ...(entry.workingDirectory === undefined ? {} : { workingDirectory: entry.workingDirectory }),
      version,
      unchanged,
      content: unchanged ? "" : content,
    };
  });
  return SkillLibrary.of({ catalog, read });
});

export const layer = Layer.effect(SkillLibrary, make);
