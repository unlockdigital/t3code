import { TextGenerationError } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

const decodeManifest = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      name: Schema.optional(Schema.String),
      description: Schema.optional(Schema.String),
      language: Schema.optional(Schema.String),
      runtime: Schema.optional(Schema.String),
    }),
  ),
);

const README_NAMES = ["README.md", "README.markdown", "README.txt", "README"];
const CREDENTIAL_NAME = /(?:secret|credential|password|token|private[-_]?key|^auth(?:\.|$))/i;

function safeSegments(relative: string) {
  const segments = relative.replaceAll("\\", "/").split("/");
  return segments.every(
    (segment) => segment.length > 0 && !segment.startsWith(".") && !CREDENTIAL_NAME.test(segment),
  );
}

/** V1 context selection accepts a visible project-relative Markdown file. */
export function isProjectBriefContextPath(value: string): boolean {
  return safeSegments(value) && !/^[a-z]:/i.test(value) && /\.(?:md|markdown)$/i.test(value);
}

export const collectProjectBriefSources = Effect.fn("ProjectBriefSources.collect")(function* (
  cwd: string,
  contextFile?: string | null,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const root = yield* fs.realPath(cwd).pipe(
    Effect.mapError(
      (cause) =>
        new TextGenerationError({
          operation: "generateProjectBrief",
          detail: "The project directory is unavailable. Reconnect its environment and try again.",
          cause,
        }),
    ),
  );
  if (contextFile && (!isProjectBriefContextPath(contextFile) || path.isAbsolute(contextFile))) {
    return yield* new TextGenerationError({
      operation: "generateProjectBrief",
      detail: "Choose a visible project-relative Markdown context file without credential names.",
    });
  }
  const read = Effect.fn("ProjectBriefSources.read")(
    function* (name: string, limit: number) {
      const resolved = yield* fs.realPath(path.join(root, name));
      const relative = path.relative(root, resolved);
      if (path.isAbsolute(relative) || !safeSegments(relative)) return null;
      const info = yield* fs.stat(resolved);
      if (info.type !== "File") return null;
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const file = yield* fs.open(resolved, {
            flag: "r",
            ...(platform === "win32" ? {} : { noFollow: true }),
          });
          if ((yield* file.stat).type !== "File") return null;
          // Bound actual reads as well as the data sent to the model, including oversized files.
          const chunks: Uint8Array[] = [];
          let bytes = 0;
          while (bytes < limit) {
            const next = yield* file.readAlloc(limit - bytes);
            if (Option.isNone(next)) break;
            if (next.value.length === 0) break;
            chunks.push(next.value);
            bytes += next.value.length;
          }
          // Check containment again before admitting content after opening the handle.
          if ((yield* fs.realPath(path.join(root, name))) !== resolved) return null;
          const buffer = new Uint8Array(bytes);
          let offset = 0;
          for (const chunk of chunks) {
            buffer.set(chunk, offset);
            offset += chunk.length;
          }
          if (buffer.some((byte) => byte < 32 && byte !== 9 && byte !== 10 && byte !== 13))
            return null;
          const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer, {
            stream: info.size > BigInt(bytes),
          });
          if (text.includes("\uFFFD")) return null;
          return text.trim();
        }),
      );
    },
    Effect.orElseSucceed(() => null),
  );
  const sections: string[] = [];
  const sources: string[] = [];
  for (const name of README_NAMES) {
    // The first existing root README owns the budget; an unsafe/binary file never selects another.
    if (!(yield* fs.exists(path.join(root, name)).pipe(Effect.orElseSucceed(() => false))))
      continue;
    const text = yield* read(name, 6 * 1024);
    if (text) {
      sections.push(text);
      sources.push(name);
    }
    break;
  }
  const manifest = yield* read("package.json", 2 * 1024);
  if (manifest) {
    const parsed = yield* decodeManifest(manifest).pipe(Effect.orElseSucceed(() => null));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const fields: Record<string, string> = {};
      for (const key of ["name", "description", "language", "runtime"] as const) {
        const value = Reflect.get(parsed, key);
        if (typeof value === "string") fields[key] = value.slice(0, 512);
      }
      if (Object.keys(fields).length > 0) {
        sections.push(
          Object.entries(fields)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n"),
        );
        sources.push("package.json");
      }
    }
  }
  if (contextFile) {
    const text = yield* read(contextFile, 8 * 1024);
    if (!text)
      return yield* new TextGenerationError({
        operation: "generateProjectBrief",
        detail:
          "The selected context file is unavailable, unsafe, or empty. Choose a readable Markdown file within this project.",
      });
    sections.push(text);
    sources.push(contextFile);
  }
  if (sections.join("").length < 20)
    return yield* new TextGenerationError({
      operation: "generateProjectBrief",
      detail:
        "Project context is insufficient. Add a root README or select a Markdown file describing its mission and current emphasis.",
    });
  // Source names travel separately; untrusted contents have no authority in the generation prompt.
  const encoded = new TextEncoder().encode(sections.join("\n\n"));
  const text = new TextDecoder().decode(encoded.subarray(0, 16 * 1024), { stream: true });
  return { text, sources, canonicalRoot: root };
});
