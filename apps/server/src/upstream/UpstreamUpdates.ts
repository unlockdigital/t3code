// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalDateInEffect:off
// This Node adapter keeps subprocess exit codes, output limits, and request deadlines explicit.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { UpstreamError, UpstreamStatus, type UpstreamRequest } from "@t3tools/contracts";
import * as ServerConfig from "../config.ts";

const isUpstreamError = Schema.is(UpstreamError);

const SourceConfig = Schema.Struct({
  repository: Schema.String,
  fork: Schema.String,
  baseTag: Schema.String,
  baseCommit: Schema.String,
});
const Release = Schema.Struct({
  tag_name: Schema.String,
  body: Schema.NullOr(Schema.String),
  draft: Schema.Boolean,
  prerelease: Schema.Boolean,
});
const Advisories = Schema.Array(
  Schema.Struct({
    ghsa_id: Schema.String,
    summary: Schema.String,
    vulnerabilities: Schema.optionalKey(
      Schema.Array(
        Schema.Struct({
          package: Schema.Struct({ name: Schema.NullOr(Schema.String) }),
          patched_versions: Schema.NullOr(Schema.String),
        }),
      ),
    ),
  }),
);

const decodeSource = Schema.decodeUnknownSync(Schema.fromJsonString(SourceConfig));
const decodeRelease = Schema.decodeUnknownSync(Release);
const decodeAdvisories = Schema.decodeUnknownSync(Advisories);
const encodeStatus = Schema.encodeSync(Schema.fromJsonString(UpstreamStatus));
const decodeUnknownJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const decodeStatus = Schema.decodeUnknownSync(Schema.fromJsonString(UpstreamStatus));

function version(tag: string) {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  return match ? match.slice(1).map(Number) : null;
}
export function selectStable(input: unknown) {
  const release = decodeRelease(input);
  return !release.draft && !release.prerelease && version(release.tag_name) ? release : null;
}
function compareVersions(a: string, b: string) {
  const left = version(a);
  const right = version(b);
  if (!left || !right) throw new Error("Invalid stable version");
  return left[0]! - right[0]! || left[1]! - right[1]! || left[2]! - right[2]!;
}
export function repositoryIdentity(url: string) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(
    url.trim(),
  );
  return match?.[1]?.toLowerCase() ?? null;
}

function git(
  cwd: string,
  args: string[],
  allowFailure = false,
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    NodeChildProcess.execFile(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "protocol.file.allow=never",
        "-c",
        "commit.gpgSign=false",
        "-c",
        "merge.gpgSign=false",
        ...args,
      ],
      {
        cwd,
        timeout: 90_000,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_MERGE_AUTOEDIT: "no" },
      },
      (error, stdout) => {
        if (error && (!allowFailure || error.killed || typeof error.code !== "number"))
          reject(error);
        else resolve({ code: error ? 1 : 0, stdout: stdout.trim() });
      },
    );
  });
}
async function publicGithub(path: string): Promise<unknown> {
  const response = await fetch(`https://api.github.com/${path}`, {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    signal: AbortSignal.timeout(20_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
  if (!response.body) throw new Error("GitHub response missing");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2_000_000) {
        await reader.cancel();
        throw new Error("GitHub response too large");
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return decodeUnknownJson(body);
}

export class UpstreamHost extends Context.Service<
  UpstreamHost,
  {
    readonly git: typeof git;
    readonly github: typeof publicGithub;
  }
>()("t3/upstream/UpstreamUpdates/UpstreamHost") {}
const hostLayer = Layer.succeed(UpstreamHost, { git, github: publicGithub });

export class UpstreamUpdates extends Context.Service<
  UpstreamUpdates,
  {
    readonly execute: (input: UpstreamRequest) => Effect.Effect<UpstreamStatus, UpstreamError>;
  }
>()("t3/upstream/UpstreamUpdates") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const lock = yield* Semaphore.make(1);
  const host = yield* UpstreamHost;
  const git = host.git;
  const publicGithub = host.github;
  const execute = Effect.fn("UpstreamUpdates.execute")((input: UpstreamRequest) =>
    Effect.tryPromise({
      try: async () => {
        const root = (
          await git(config.cwd, ["rev-parse", "--show-toplevel"]).catch((cause) => {
            throw new UpstreamError({ stage: "checkout", cause });
          })
        ).stdout;
        let source;
        try {
          source = decodeSource(
            await NodeFSP.readFile(
              NodePath.join(root, "docs/unlock-digital/upstream.json"),
              "utf8",
            ),
          );
        } catch (cause) {
          throw new UpstreamError({ stage: "configuration", cause });
        }
        // This fork boundary restricts all network and merge operations to the intended source.
        if (
          source.repository !== "pingdotgg/t3code" ||
          source.fork !== "unlockdigital/t3code" ||
          !version(source.baseTag) ||
          !/^[a-f0-9]{40}$/.test(source.baseCommit)
        )
          throw new UpstreamError({ stage: "configuration", cause: undefined });
        for (const [remote, expected] of [
          ["upstream", source.repository],
          ["origin", source.fork],
        ]) {
          if (
            repositoryIdentity(
              (
                await git(root, ["remote", "get-url", remote!]).catch((cause) => {
                  throw new UpstreamError({ stage: "repository-identity", cause });
                })
              ).stdout,
            ) !== expected
          )
            throw new UpstreamError({ stage: "repository-identity", cause: undefined });
        }
        if (
          (await git(root, ["merge-base", "--is-ancestor", source.baseCommit, "HEAD"], true))
            .code !== 0
        )
          throw new UpstreamError({ stage: "base-ancestry", cause: undefined });
        const common = (
          await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
        ).stdout;
        const statePath = NodePath.join(common, "t3-upstream-state.json");
        let saved: UpstreamStatus | null = null;
        try {
          saved = decodeStatus(await NodeFSP.readFile(statePath, "utf8"));
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
            throw new UpstreamError({ stage: "candidate-record", cause: error });
        }
        const state: UpstreamStatus = saved ?? {
          ...source,
          customCommits: 0,
          dirty: false,
          latest: null,
          updateAvailable: false,
          checkedAt: null,
          releaseError: null,
          security: { checkedAt: null, error: null, advisories: [] },
          candidates: [],
        };
        const result = {
          ...state,
          ...source,
          candidates: state.candidates.map((candidate) => ({ ...candidate })),
          customCommits: Number(
            (await git(root, ["rev-list", "--count", `${source.baseCommit}..HEAD`])).stdout,
          ),
          dirty:
            (await git(root, ["status", "--porcelain", "--untracked-files=normal"])).stdout !== "",
        };
        const save = async () => {
          await NodeFSP.writeFile(`${statePath}.tmp`, encodeStatus(result), { mode: 0o600 });
          await NodeFSP.rename(`${statePath}.tmp`, statePath);
        };
        if (input.action === "refresh" || input.action === "prepare") {
          try {
            const latest = selectStable(
              await publicGithub(`repos/${source.repository}/releases/latest`),
            );
            if (!latest) throw new Error("No stable release");
            result.latest = {
              tag: latest.tag_name,
              url: `https://github.com/${source.repository}/releases/tag/${latest.tag_name}`,
              notes: (latest.body ?? "").slice(0, 40_000),
              securityNotes: (latest.body ?? "")
                .split("\n")
                .filter((line) => /security|vulnerab|CVE-|GHSA-/i.test(line))
                .slice(0, 30)
                .map((line) => line.slice(0, 1000)),
            };
            result.checkedAt = new Date().toISOString();
            result.releaseError = null;
          } catch {
            result.releaseError =
              "Official releases unavailable. Retry the check before preparing an update.";
          }
          try {
            const advisories = decodeAdvisories(
              await publicGithub(`repos/${source.repository}/security-advisories?per_page=100`),
            );
            result.security = {
              checkedAt: new Date().toISOString(),
              error:
                advisories.length === 100
                  ? "First 100 advisories shown; review GitHub for the full list."
                  : null,
              advisories: advisories.map((item) => ({
                title: item.summary,
                url: `https://github.com/${source.repository}/security/advisories/${item.ghsa_id}`,
                fixes: (item.vulnerabilities ?? []).map(
                  (entry) =>
                    `${entry.package.name ?? "Package"}: ${entry.patched_versions ? `patched versions ${entry.patched_versions}` : "no patched versions published"}`,
                ),
              })),
            };
          } catch {
            result.security = {
              ...result.security,
              error: "Public security advisories unavailable. Previous results may be stale.",
            };
          }
        }
        result.updateAvailable =
          result.latest !== null && compareVersions(result.latest.tag, source.baseTag) > 0;
        const candidateRoot = NodePath.join(
          NodePath.dirname(root),
          `${NodePath.basename(root)}-upstream-candidates`,
        );
        for (const candidate of result.candidates) {
          if (
            candidate.path !== NodePath.join(candidateRoot, candidate.id) ||
            candidate.branch !== `upstream-candidate/${candidate.id}` ||
            !/^[a-f0-9-]{36}$/.test(candidate.id)
          )
            throw new UpstreamError({ stage: "candidate-record", cause: undefined });
          const exists = await NodeFSP.stat(candidate.path).catch(
            (error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return null;
              throw error;
            },
          );
          if (!exists) candidate.status = "missing";
          else if ((await git(candidate.path, ["diff", "--name-only", "--diff-filter=U"])).stdout)
            candidate.status = "conflicted";
          else if (candidate.status === "preparing") candidate.status = "failed";
        }
        if (input.action === "prepare") {
          if (result.dirty) throw new UpstreamError({ stage: "dirty-checkout", cause: undefined });
          if (result.releaseError || !result.latest) {
            await save();
            throw new UpstreamError({ stage: "release-check", cause: undefined });
          }
          if (input.selectedTag !== result.latest.tag) {
            await save();
            throw new UpstreamError({ stage: "release-changed", cause: undefined });
          }
          if (result.updateAvailable) {
            const id = NodeCrypto.randomUUID();
            const candidate = {
              id,
              path: NodePath.join(candidateRoot, id),
              branch: `upstream-candidate/${id}`,
              tag: result.latest.tag,
              head: (await git(root, ["rev-parse", "HEAD"])).stdout,
              status: "preparing" as UpstreamStatus["candidates"][number]["status"],
            };
            // Fetch a private ref from the canonical URL, independent of remote refspecs and local tags.
            const ref = `refs/t3-upstream/${id}`;
            await git(root, [
              "fetch",
              "--no-tags",
              "--",
              `https://github.com/${source.repository}.git`,
              `refs/tags/${candidate.tag}:${ref}`,
            ]);
            const target = (await git(root, ["rev-parse", `${ref}^{commit}`])).stdout;
            if (
              (await git(root, ["merge-base", "--is-ancestor", source.baseCommit, target], true))
                .code !== 0
            )
              throw new UpstreamError({ stage: "release-ancestry", cause: undefined });
            if (
              (await git(root, ["merge-base", "--is-ancestor", target, "HEAD"], true)).code === 0
            ) {
              result.updateAvailable = false;
              await save();
              return result;
            }
            await NodeFSP.mkdir(candidateRoot, { recursive: true });
            result.candidates.push(candidate);
            await save();
            try {
              await git(root, [
                "worktree",
                "add",
                "-b",
                candidate.branch,
                "--",
                candidate.path,
                candidate.head,
              ]);
              const merge = await git(
                candidate.path,
                ["merge", "--no-edit", "--no-ff", target],
                true,
              );
              candidate.status =
                merge.code === 0
                  ? "clean"
                  : (await git(candidate.path, ["diff", "--name-only", "--diff-filter=U"])).stdout
                    ? "conflicted"
                    : "failed";
              candidate.head = (await git(candidate.path, ["rev-parse", "HEAD"])).stdout;
            } catch {
              candidate.status = "failed";
            }
            await save();
          }
        }
        if (input.action === "cleanup") {
          const candidate = result.candidates.find((item) => item.id === input.candidateId);
          if (!candidate || candidate.status !== "clean")
            throw new UpstreamError({ stage: "candidate-review", cause: undefined });
          if (
            (
              await git(candidate.path, [
                "status",
                "--porcelain",
                "--untracked-files=all",
                "--ignored",
              ])
            ).stdout ||
            (await git(candidate.path, ["rev-parse", "HEAD"])).stdout !== candidate.head
          )
            throw new UpstreamError({ stage: "candidate-changed", cause: undefined });
          if (
            (await git(candidate.path, ["symbolic-ref", "--short", "HEAD"])).stdout !==
            candidate.branch
          )
            throw new UpstreamError({ stage: "candidate-changed", cause: undefined });
          await git(root, ["worktree", "remove", "--", candidate.path]);
          // Keep the branch as a recovery point; removing a worktree never deletes commits.
          result.candidates = result.candidates.filter((item) => item.id !== candidate.id);
        }
        await save();
        return result;
      },
      catch: (cause) =>
        isUpstreamError(cause) ? cause : new UpstreamError({ stage: input.action, cause }),
    }).pipe(Effect.uninterruptible, lock.withPermits(1)),
  );
  return UpstreamUpdates.of({ execute });
});
export const layerWithHost = Layer.effect(UpstreamUpdates, make);
export const layer = layerWithHost.pipe(Layer.provide(hostLayer));
