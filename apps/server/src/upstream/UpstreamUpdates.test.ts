// @effect-diagnostics nodeBuiltinImport:off
// Local Git fixtures exercise actual merges and worktree removal without network or app state.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { UpstreamStatus } from "@t3tools/contracts";
import * as ServerConfig from "../config.ts";
import * as UpstreamUpdates from "./UpstreamUpdates.ts";

const release = (tag = "v0.1.3") => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  body: "Security: fixture fix",
});
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeState = Schema.decodeUnknownSync(Schema.fromJsonString(UpstreamStatus));

function git(
  cwd: string,
  args: string[],
  allowFailure = false,
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    NodeChildProcess.execFile(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false", ...args],
      { cwd, timeout: 15_000, encoding: "utf8" },
      (error, stdout) => {
        if (error && !allowFailure) reject(error);
        else resolve({ code: error ? 1 : 0, stdout: stdout.trim() });
      },
    );
  });
}

const fixture = (
  options: { conflict?: boolean; github?: (path: string) => Promise<unknown> } = {},
) =>
  Effect.gen(function* () {
    const directory = yield* Effect.acquireRelease(
      Effect.tryPromise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-upstream-fixture-")),
      ),
      (directory) => Effect.promise(() => NodeFSP.rm(directory, { recursive: true, force: true })),
    );
    const setup = yield* Effect.tryPromise(async () => {
      const root = NodePath.join(directory, "source");
      await NodeFSP.mkdir(root);
      await git(root, ["init", "-b", "fork"]);
      await git(root, ["config", "user.email", "fixture@example.test"]);
      await git(root, ["config", "user.name", "Fixture"]);
      await git(root, ["remote", "add", "origin", "https://github.com/unlockdigital/t3code.git"]);
      await git(root, ["remote", "add", "upstream", "https://github.com/pingdotgg/t3code.git"]);
      await NodeFSP.writeFile(NodePath.join(root, "shared.txt"), "base\n");
      await NodeFSP.writeFile(NodePath.join(root, ".gitignore"), ".env\n");
      await git(root, ["add", "."]);
      await git(root, ["commit", "-m", "base"]);
      const base = (await git(root, ["rev-parse", "HEAD"])).stdout;
      await git(root, ["switch", "-c", "official"]);
      await NodeFSP.writeFile(
        NodePath.join(root, options.conflict ? "shared.txt" : "official.txt"),
        "official\n",
      );
      await git(root, ["add", "."]);
      await git(root, ["commit", "-m", "official release fixture"]);
      const target = (await git(root, ["rev-parse", "HEAD"])).stdout;
      await git(root, ["switch", "fork"]);
      await NodeFSP.writeFile(
        NodePath.join(root, options.conflict ? "shared.txt" : "custom.txt"),
        "customization\n",
      );
      await NodeFSP.mkdir(NodePath.join(root, "docs/unlock-digital"), { recursive: true });
      await NodeFSP.writeFile(
        NodePath.join(root, "docs/unlock-digital/upstream.json"),
        encodeJson({
          repository: "pingdotgg/t3code",
          fork: "unlockdigital/t3code",
          baseTag: "v0.1.2",
          baseCommit: base,
        }),
      );
      await git(root, ["add", "."]);
      await git(root, ["commit", "-m", "fork customization"]);
      return { root, target, head: (await git(root, ["rev-parse", "HEAD"])).stdout };
    });
    const calls: string[][] = [];
    const host = Layer.succeed(UpstreamUpdates.UpstreamHost, {
      github:
        options.github ?? (async (path) => (path.endsWith("/releases/latest") ? release() : [])),
      git: async (cwd, args, allowFailure) => {
        calls.push(args);
        if (args[0] === "fetch") {
          expect(args.slice(0, 4)).toEqual([
            "fetch",
            "--no-tags",
            "--",
            "https://github.com/pingdotgg/t3code.git",
          ]);
          // Replace only the external fetch with a fixture ref; all validation and Git mutations run for real.
          const ref = args[4]!.split(":")[1]!;
          return git(cwd, ["update-ref", ref, setup.target]);
        }
        return git(cwd, args, allowFailure);
      },
    });
    const service = yield* UpstreamUpdates.UpstreamUpdates.pipe(
      Effect.provide(
        UpstreamUpdates.layerWithHost.pipe(
          Layer.provide(host),
          Layer.provide(ServerConfig.layerTest(setup.root, NodePath.join(directory, "home"))),
          Layer.provide(NodeServices.layer),
        ),
      ),
    );
    return { ...setup, directory, service, calls, host };
  });

it("validates stable release metadata", () => {
  expect(UpstreamUpdates.selectStable(release("v0.1.10"))?.tag_name).toBe("v0.1.10");
  expect(UpstreamUpdates.selectStable({ ...release(), prerelease: true })).toBeNull();
  expect(UpstreamUpdates.selectStable({ ...release(), draft: true })).toBeNull();
  expect(UpstreamUpdates.selectStable(release("v0.2.0-rc.1"))).toBeNull();
  expect(() => UpstreamUpdates.selectStable({ tag_name: "v0.1.3" })).toThrow();
});
it("recognizes the exact GitHub identity", () => {
  expect(UpstreamUpdates.repositoryIdentity("git@github.com:pingdotgg/t3code.git")).toBe(
    "pingdotgg/t3code",
  );
  expect(UpstreamUpdates.repositoryIdentity("https://github.com/pingdotgg/t3code.git")).toBe(
    "pingdotgg/t3code",
  );
  expect(
    UpstreamUpdates.repositoryIdentity("https://github.com.evil.test/pingdotgg/t3code"),
  ).toBeNull();
  expect(
    UpstreamUpdates.repositoryIdentity("https://github.com/pingdotgg/t3code/extra"),
  ).toBeNull();
});

it.live("prepares a merged candidate, persists it, and removes only the unchanged worktree", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { root, head, service, target } = yield* fixture();
      const prepared = yield* service.execute({ action: "prepare", selectedTag: "v0.1.3" });
      const candidate = prepared.candidates[0]!;
      expect(candidate.status).toBe("clean");
      expect(prepared.customCommits).toBe(1);
      yield* Effect.tryPromise(async () => {
        expect((await git(root, ["rev-parse", "HEAD"])).stdout).toBe(head);
        expect((await git(root, ["branch", "--show-current"])).stdout).toBe("fork");
        expect(
          (await git(candidate.path, ["merge-base", "--is-ancestor", target, "HEAD"])).code,
        ).toBe(0);
        expect(await NodeFSP.readFile(NodePath.join(candidate.path, "custom.txt"), "utf8")).toBe(
          "customization\n",
        );
        const saved = decodeState(
          await NodeFSP.readFile(NodePath.join(root, ".git/t3-upstream-state.json"), "utf8"),
        );
        expect(saved.candidates).toEqual(prepared.candidates);
      });
      const restored = yield* service.execute({ action: "read" });
      expect(restored.candidates).toEqual(prepared.candidates);
      const cleaned = yield* service.execute({ action: "cleanup", candidateId: candidate.id });
      expect(cleaned.candidates).toEqual([]);
      yield* Effect.tryPromise(async () => {
        expect(
          (await git(root, ["show-ref", "--verify", `refs/heads/${candidate.branch}`])).code,
        ).toBe(0);
        await expect(NodeFSP.stat(candidate.path)).rejects.toMatchObject({ code: "ENOENT" });
      });
    }),
  ),
);

it.live("preserves conflicts for review and blocks cleanup", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { root, head, service } = yield* fixture({ conflict: true });
      const result = yield* service.execute({ action: "prepare", selectedTag: "v0.1.3" });
      const candidate = result.candidates[0]!;
      expect(candidate.status).toBe("conflicted");
      expect(
        (yield* service.execute({ action: "cleanup", candidateId: candidate.id }).pipe(Effect.flip))
          .stage,
      ).toBe("candidate-review");
      yield* Effect.tryPromise(async () => {
        expect((await git(candidate.path, ["diff", "--name-only", "--diff-filter=U"])).stdout).toBe(
          "shared.txt",
        );
        expect((await git(root, ["rev-parse", "HEAD"])).stdout).toBe(head);
      });
    }),
  ),
);

it.live.each(["tracked", "untracked", "ignored", "commit"] as const)(
  "preserves a candidate containing %s changes",
  (change) =>
    Effect.scoped(
      Effect.gen(function* () {
        const { service } = yield* fixture();
        const prepared = yield* service.execute({ action: "prepare", selectedTag: "v0.1.3" });
        const candidate = prepared.candidates[0]!;
        yield* Effect.tryPromise(async () => {
          await NodeFSP.writeFile(
            NodePath.join(
              candidate.path,
              change === "ignored"
                ? ".env"
                : change === "untracked"
                  ? "personal.txt"
                  : "custom.txt",
            ),
            "preserve me\n",
          );
          if (change === "commit") {
            await git(candidate.path, ["add", "."]);
            await git(candidate.path, ["commit", "-m", "candidate follow-up"]);
          }
        });
        expect(
          (yield* service
            .execute({ action: "cleanup", candidateId: candidate.id })
            .pipe(Effect.flip)).stage,
        ).toBe("candidate-changed");
        expect((yield* service.execute({ action: "read" })).candidates).toHaveLength(1);
        yield* Effect.tryPromise(async () => {
          expect((await NodeFSP.stat(candidate.path)).isDirectory()).toBe(true);
        });
      }),
    ),
);

it.live("blocks preparation from a dirty checkout and preserves unpublished changes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { root, service, calls } = yield* fixture();
      yield* Effect.tryPromise(() =>
        NodeFSP.writeFile(NodePath.join(root, "unpublished.txt"), "keep"),
      );
      expect(
        (yield* service.execute({ action: "prepare", selectedTag: "v0.1.3" }).pipe(Effect.flip))
          .stage,
      ).toBe("dirty-checkout");
      expect(calls.some((args) => args[0] === "fetch" || args[0] === "worktree")).toBe(false);
      yield* Effect.tryPromise(async () => {
        expect(await NodeFSP.readFile(NodePath.join(root, "unpublished.txt"), "utf8")).toBe("keep");
      });
    }),
  ),
);

it.live("rejects another upstream before any network call or candidate creation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { root, service, calls } = yield* fixture({
        github: async () => {
          throw new Error("must not call");
        },
      });
      yield* Effect.tryPromise(() =>
        git(root, ["remote", "set-url", "upstream", "https://github.com/other/t3code.git"]),
      );
      expect(
        (yield* service.execute({ action: "prepare", selectedTag: "v0.1.3" }).pipe(Effect.flip))
          .stage,
      ).toBe("repository-identity");
      expect(calls.some((args) => args[0] === "fetch" || args[0] === "worktree")).toBe(false);
    }),
  ),
);

it.live(
  "distinguishes checked-empty advisories from unavailable metadata and retains cached success",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const response = { fail: false };
        const { service } = yield* fixture({
          github: async (path) => {
            if (response.fail) throw new Error("offline");
            return path.endsWith("/releases/latest") ? release() : [];
          },
        });
        const success = yield* service.execute({ action: "refresh" });
        expect(success.security.checkedAt).not.toBeNull();
        expect(success.security.error).toBeNull();
        expect(success.security.advisories).toEqual([]);
        expect(success.latest?.securityNotes).toEqual(["Security: fixture fix"]);
        response.fail = true;
        const failure = yield* service.execute({ action: "refresh" });
        expect(failure.releaseError).not.toBeNull();
        expect(failure.security.error).not.toBeNull();
        expect(failure.checkedAt).toBe(success.checkedAt);
        expect(failure.latest).toEqual(success.latest);
        expect(
          (yield* service.execute({ action: "prepare", selectedTag: "v0.1.3" }).pipe(Effect.flip))
            .stage,
        ).toBe("release-check");
      }),
    ),
);

it.live("reports up to date without making a worktree for the recorded release", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { service, calls } = yield* fixture({
        github: async (path) => (path.endsWith("/releases/latest") ? release("v0.1.2") : []),
      });
      const status = yield* service.execute({ action: "prepare", selectedTag: "v0.1.2" });
      expect(status.updateAvailable).toBe(false);
      expect(status.candidates).toEqual([]);
      expect(calls.some((args) => args[0] === "fetch" || args[0] === "worktree")).toBe(false);
    }),
  ),
);

it.live("requires the selected release to match fresh official metadata", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { service, calls } = yield* fixture();
      expect(
        (yield* service.execute({ action: "prepare", selectedTag: "v0.1.2" }).pipe(Effect.flip))
          .stage,
      ).toBe("release-changed");
      expect(calls.some((args) => args[0] === "fetch" || args[0] === "worktree")).toBe(false);
      expect((yield* service.execute({ action: "read" })).latest?.tag).toBe("v0.1.3");
    }),
  ),
);

it.live("shows published patched versions with official advisory provenance", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { service } = yield* fixture({
        github: async (path) =>
          path.endsWith("/releases/latest")
            ? release()
            : [
                {
                  ghsa_id: "GHSA-fixture-1234",
                  summary: "Fixture advisory",
                  vulnerabilities: [
                    {
                      package: { ecosystem: "npm", name: "example" },
                      patched_versions: "1.2.3",
                    },
                    { package: { ecosystem: "npm", name: "unpatched" }, patched_versions: null },
                  ],
                },
              ],
      });
      expect((yield* service.execute({ action: "refresh" })).security.advisories).toEqual([
        {
          title: "Fixture advisory",
          url: "https://github.com/pingdotgg/t3code/security/advisories/GHSA-fixture-1234",
          fixes: ["example: patched versions 1.2.3", "unpatched: no patched versions published"],
        },
      ]);
    }),
  ),
);

it.live("rejects a recorded base outside HEAD's ancestry", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { root, service, calls } = yield* fixture();
      yield* Effect.tryPromise(async () => {
        const file = NodePath.join(root, "docs/unlock-digital/upstream.json");
        await NodeFSP.writeFile(
          file,
          encodeJson({
            repository: "pingdotgg/t3code",
            fork: "unlockdigital/t3code",
            baseTag: "v0.1.2",
            baseCommit: "a".repeat(40),
          }),
        );
      });
      expect((yield* service.execute({ action: "refresh" }).pipe(Effect.flip)).stage).toBe(
        "base-ancestry",
      );
      expect(calls.some((args) => args[0] === "fetch" || args[0] === "worktree")).toBe(false);
    }),
  ),
);

it.live("keeps missing candidate records visible for manual recovery", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { root, service } = yield* fixture();
      const candidate = (yield* service.execute({ action: "prepare", selectedTag: "v0.1.3" }))
        .candidates[0]!;
      yield* Effect.tryPromise(() => git(root, ["worktree", "remove", "--", candidate.path]));
      expect((yield* service.execute({ action: "read" })).candidates[0]?.status).toBe("missing");
      expect(
        (yield* service.execute({ action: "cleanup", candidateId: candidate.id }).pipe(Effect.flip))
          .stage,
      ).toBe("candidate-review");
    }),
  ),
);

it.live("resolves candidate path stably when read from a linked worktree", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { root, directory, service, host } = yield* fixture();
      const candidate = (yield* service.execute({ action: "prepare", selectedTag: "v0.1.3" }))
        .candidates[0]!;
      const linkedWorktree = NodePath.join(directory, "linked-worktree");
      yield* Effect.tryPromise(async () => {
        await git(root, ["worktree", "add", "-b", "linked-branch", "--", linkedWorktree, "HEAD"]);
      });
      const worktreeService = yield* UpstreamUpdates.UpstreamUpdates.pipe(
        Effect.provide(
          UpstreamUpdates.layerWithHost.pipe(
            Layer.provide(host),
            Layer.provide(
              ServerConfig.layerTest(linkedWorktree, NodePath.join(directory, "home2")),
            ),
            Layer.provide(NodeServices.layer),
          ),
        ),
      );
      const read = yield* worktreeService.execute({ action: "read" });
      expect(read.candidates[0]?.id).toBe(candidate.id);
      expect(read.candidates[0]?.status).toBe("clean");
    }),
  ),
);
