// @effect-diagnostics nodeBuiltinImport:off - Exercises the CLI against disposable Git repositories.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

it.each([
  { name: "the fork's default branch", remote: "origin/fork/main", hasDefault: true, args: [] },
  {
    name: "origin/main when the remote default is unknown",
    remote: "origin/main",
    hasDefault: false,
    args: [],
  },
  {
    name: "an explicit comparison ref",
    remote: "origin/fork/main",
    hasDefault: false,
    args: ["baseline"],
  },
])("checks against $name", ({ remote, hasDefault, args }) => {
  using temporary = NodeFS.mkdtempDisposableSync(
    NodePath.join(NodeOS.tmpdir(), "t3-check-changed-"),
  );
  const root = temporary.path;
  const sourceRoot = NodePath.resolve(import.meta.dirname, "..");
  for (const file of ["scripts/check-changed.ts", ".github/scripts/ci-changes.cjs"]) {
    const destination = NodePath.join(root, file);
    NodeFS.mkdirSync(NodePath.dirname(destination), { recursive: true });
    NodeFS.copyFileSync(NodePath.join(sourceRoot, file), destination);
  }
  NodeFS.writeFileSync(NodePath.join(root, "package.json"), '{"type":"module"}\n');
  const git = (...command: Array<string>) =>
    NodeChildProcess.execFileSync("git", command, { cwd: root, encoding: "utf8" });
  git("init", "--quiet", "--initial-branch=work");
  git("add", ".");
  git(
    "-c",
    "user.name=Synthetic Maintainer",
    "-c",
    "user.email=maintainer@example.invalid",
    "-c",
    "commit.gpgSign=false",
    "commit",
    "--quiet",
    "-m",
    "Synthetic baseline",
  );
  git("tag", "baseline");
  git("update-ref", `refs/remotes/${remote}`, "HEAD");
  if (hasDefault) git("symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/${remote}`);
  const result = NodeChildProcess.spawnSync(
    process.execPath,
    [NodePath.join(root, "scripts/check-changed.ts"), ...args],
    { cwd: root, encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("check:changed: no changes since");
});
