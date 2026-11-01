import { TextGenerationError } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

const README_NAMES = ["README.md", "README.markdown", "README.txt", "README"];
const CREDENTIAL_NAME = /(?:secret|credential|password|token|private[-_]?key|^auth(?:\.|$))/i;

function safeSegments(relative: string) {
  const segments = relative.replaceAll("\\", "/").split("/");
  return segments.every(
    (segment) => segment.length > 0 && !segment.startsWith(".") && !CREDENTIAL_NAME.test(segment),
  );
}

/** Selection stays within canonical README locations rather than arbitrary documents. */
export function isProjectBriefContextPath(value: string): boolean {
  return (
    safeSegments(value) &&
    /^(?:(?:docs|documentation)\/)?README(?:\.(?:md|markdown|txt))?$/.test(value)
  );
}

// This is a narrow credential tripwire, not a classifier for confidential prose.
function containsProjectBriefCredential(text: string): boolean {
  if (/-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/.test(text)) return true;
  if (
    /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|AKIA[A-Z0-9]{12,}|ASIA[A-Z0-9]{12,})/.test(
      text,
    )
  )
    return true;
  if (/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:/]+:[^\s@]+@/i.test(text))
    return true;
  const assignments = text.matchAll(
    /(?:["']?\b(?:[A-Z0-9_]*(?:API[_-]?KEY|ACCESS[_-]?TOKEN|SECRET[_-]?KEY|CLIENT[_-]?SECRET|PASSWORD)[A-Z0-9_]*|TOKEN|SECRET)["']?)\s*[:=]\s*["']?([^\s"'`,;]{8,})/gi,
  );
  for (const match of assignments) {
    const value = match[1]!;
    if (
      !/^(?:\$\{[^}]+\}|<[^>]+>|\{\{[^}]+\}\}|[*x]+|(?:your|replace|example|placeholder|changeme|redacted)(?:[-_].*)?)$/i.test(
        value,
      )
    )
      return true;
  }
  return false;
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
      detail: "Choose a canonical README in the project root, docs, or documentation directory.",
    });
  }
  const read = Effect.fn("ProjectBriefSources.read")(
    function* (name: string, limit: number) {
      const resolved = yield* fs.realPath(path.join(root, name));
      if (resolved !== path.join(root, name)) return null;
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
  // An explicitly reviewed document replaces the README, so sensitive README
  // contents cannot hitchhike on a deliberately selected safe source.
  const candidates = contextFile ? [contextFile] : README_NAMES;
  for (const name of candidates) {
    if (!(yield* fs.exists(path.join(root, name)).pipe(Effect.orElseSucceed(() => false))))
      continue;
    const text = yield* read(name, 4 * 1024);
    if (text) {
      sections.push(text);
      sources.push(name);
    }
    break;
  }
  if (contextFile && sections.length === 0)
    return yield* new TextGenerationError({
      operation: "generateProjectBrief",
      detail:
        "The selected context file is unavailable, unsafe, or empty. Choose a regular README file in the project root, docs, or documentation directory.",
    });
  if (sections.join("").length < 20)
    return yield* new TextGenerationError({
      operation: "generateProjectBrief",
      detail:
        "Project context is insufficient. Add a root README or select docs/README.md describing its mission and current emphasis.",
    });
  // Source names travel separately; untrusted contents have no authority in the generation prompt.
  const encoded = new TextEncoder().encode(sections.join("\n\n"));
  const text = new TextDecoder().decode(encoded.subarray(0, 4 * 1024), { stream: true });
  if (containsProjectBriefCredential(text))
    return yield* new TextGenerationError({
      operation: "generateProjectBrief",
      detail:
        "Project brief generation stopped locally because the selected documentation may contain credentials. Choose a reviewed README file without secrets. No brief model request was made.",
    });
  return { text, sources, canonicalRoot: root };
});
