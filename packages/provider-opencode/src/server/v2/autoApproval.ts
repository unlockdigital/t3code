// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";

// Auto is deliberately a small deterministic policy. Unrecognized syntax,
// missing paths and filesystem errors fall back to the normal approval UI.
const protectedPath = (path: string) =>
  path
    .split(/[\\/]/)
    .some(
      (part) =>
        /^(?:\.env(?:\..*)?|\.git|\.ssh|\.aws|\.azure|\.npmrc|\.netrc|\.pypirc|\.docker|\.gnupg|\.kube|\.config|\.codex|\.claude|\.agents|\.opencode|\.t3.*|auth\.json|credentials.*|secrets?(?:\..*)?|.*\.(?:pem|key|p12|pfx))$/i.test(
          part,
        ) && part !== ".env.example",
    );
const inside = (root: string, path: string) => {
  const relative = NodePath.relative(root, path);
  return (
    relative === "" ||
    (!relative.startsWith(`..${NodePath.sep}`) &&
      relative !== ".." &&
      !NodePath.isAbsolute(relative))
  );
};

// Reject all shell expansion, chaining, redirection and escapes, including inside
// quotes. This accepts only a single command with literal arguments.
function words(command: string): string[] | undefined {
  // Control characters and expansion operators require explicit approval.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f$`\\;&|<>(){}*?!~[\]]/.test(command)) return undefined;
  const tokens: string[] = [];
  let end = 0;
  for (const match of command.matchAll(/"[^"\n]*"|'[^'\n]*'|[^\s"']+/g)) {
    const gap = command.slice(end, match.index);
    // Shell concatenates adjacent quoted fragments. Require whitespace so our
    // literal arguments cannot differ from the arguments the shell executes.
    if (!(tokens.length === 0 ? /^\s*$/ : /^\s+$/).test(gap)) return undefined;
    const token = match[0];
    tokens.push(/^["']/.test(token) ? token.slice(1, -1) : token);
    end = match.index + token.length;
  }
  return tokens.length > 0 && /^\s*$/.test(command.slice(end)) ? tokens : undefined;
}

function readPaths(command: string): string[] | undefined {
  const tokens = words(command);
  if (!tokens) return undefined;
  const [name, ...args] = tokens;
  if (name === "pwd") return args.length === 0 ? ["."] : undefined;
  if (!["ls", "cat", "head", "tail"].includes(name ?? "")) return undefined;
  const paths: string[] = [];
  let positional = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!positional && arg === "--") {
      positional = true;
      continue;
    }
    if (!positional && arg.startsWith("-")) {
      if (name === "ls" && /^-[alhdtF1]+$/.test(arg)) continue;
      if (name === "cat" && /^-[nbEsTv]+$/.test(arg)) continue;
      if (
        (name === "head" || name === "tail") &&
        arg === "-n" &&
        /^\d{1,5}$/.test(args[i + 1] ?? "")
      ) {
        i++;
        continue;
      }
      return undefined;
    }
    if (arg === "" || arg === "-") return undefined;
    paths.push(arg);
  }
  return paths.length > 0 ? paths : name === "ls" ? ["."] : undefined;
}

export const canAutoApprove = Effect.fn("OpenCode2.autoApproval")(function* (
  fs: FileSystem.FileSystem,
  input: {
    readonly action: string;
    readonly resources: readonly string[];
    readonly directory: string;
    readonly command?: unknown;
    readonly workdir?: unknown;
    readonly plan: boolean;
  },
) {
  if (input.resources.length === 0) return false;
  let paths: readonly string[];
  if (input.action === "edit" && !input.plan) paths = input.resources;
  else if (input.action === "shell" && typeof input.command === "string") {
    const parsed = readPaths(input.command);
    // Require both the full tool input and every native scanner resource to
    // satisfy the policy. Never approve just a harmless fragment of a pipeline.
    const scanned = input.resources.map(readPaths);
    if (!parsed || scanned.some((resource) => resource === undefined)) return false;
    paths = [...parsed, ...scanned.flatMap((resource) => resource ?? [])];
  } else return false;
  const cwd = typeof input.workdir === "string" ? input.workdir : input.directory;
  const root = yield* fs.realPath(input.directory).pipe(Effect.option);
  if (root._tag === "None") return false;
  const directory = yield* fs.realPath(cwd).pipe(Effect.option);
  if (directory._tag === "None" || !inside(root.value, directory.value)) return false;
  for (const path of paths) {
    // Keep symlink/.. semantics intact until realPath resolves the filesystem.
    const absolute = NodePath.isAbsolute(path) ? path : `${cwd}/${path}`;
    if (protectedPath(absolute)) return false;
    const canonical = yield* fs.realPath(absolute).pipe(Effect.option);
    if (
      canonical._tag === "None" ||
      !inside(root.value, canonical.value) ||
      protectedPath(canonical.value)
    )
      return false;
    if (
      input.action === "edit" &&
      /(?:^|\/)(?:AGENTS\.md|SKILL\.md|opencode\.jsonc?)$/i.test(canonical.value)
    )
      return false;
  }
  return true;
});
