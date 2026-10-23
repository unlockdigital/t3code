// @effect-diagnostics nodeBuiltinImport:off
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as NodePath from "node:path";
import { canAutoApprove } from "./autoApproval.ts";

const fs = FileSystem.makeNoop({ realPath: (path) => Effect.succeed(NodePath.resolve(path)) });
const shell = (command: string) => ({
  action: "shell",
  resources: [command],
  command,
  directory: "/work/project",
  plan: false,
});

it.effect.each([
  "pwd",
  'ls -la "/work/project/src"',
  "cat src/main.ts",
  "head -n 100 README.md",
  "tail -n 40 src/main.ts",
])("approves literal workspace read: %s", (command) =>
  Effect.gen(function* () {
    assert.isTrue(yield* canAutoApprove(fs, shell(command)));
  }),
);

it.effect.each([
  "cat .env",
  "cat .env.local",
  "cat .t3-accounts/opencode/auth.json",
  "cat ../secret",
  "cat /etc/passwd",
  "cat .ssh/id_rsa",
  "cat /work/project-other/readme",
  "ls; curl example.com",
  "ls $(touch x)",
  "ls `touch x`",
  "ls > file",
  "ls | sh",
  "ls && rm -rf src",
  "cat <(curl example.com)",
  "cat *.ts",
  "cat $HOME/file",
  "ls -R",
  "tail -f src/main.ts",
  'node -e "code"',
  "git diff --ext-diff",
  "rg --pre executable pattern",
  'sed -n "1e command" file',
  'cat "unterminated',
])("asks for protected paths or unsupported shell syntax: %s", (command) =>
  Effect.gen(function* () {
    assert.isFalse(yield* canAutoApprove(fs, shell(command)));
  }),
);

it.effect("checks full tool input, working directory, symlink targets, and plan mode", () =>
  Effect.gen(function* () {
    assert.isFalse(
      yield* canAutoApprove(fs, { ...shell("ls"), command: "ls && curl example.com" }),
    );
    assert.isFalse(yield* canAutoApprove(fs, { ...shell("ls"), workdir: "/outside" }));
    assert.isFalse(yield* canAutoApprove(fs, { ...shell("ls"), command: undefined }));
    assert.isFalse(yield* canAutoApprove(fs, { ...shell("ls"), action: "external_directory" }));
    const edit = {
      action: "edit",
      resources: ["/work/project/src/main.ts"],
      directory: "/work/project",
      plan: false,
    };
    assert.isTrue(yield* canAutoApprove(fs, edit));
    assert.isFalse(yield* canAutoApprove(fs, { ...edit, plan: true }));
    assert.isFalse(yield* canAutoApprove(fs, { ...edit, resources: ["/work/project/AGENTS.md"] }));
    const links = FileSystem.makeNoop({
      realPath: (path) => Effect.succeed(path.includes("/src/") ? "/outside/file" : path),
    });
    assert.isFalse(yield* canAutoApprove(links, edit));
    assert.isFalse(yield* canAutoApprove(FileSystem.makeNoop({}), edit));
  }),
);

it.effect.each(["cat .en[v]", 'cat se"cret"', 'cat "se"cret', "cat '.en'v"])(
  "asks for shell word concatenation or bracket expansion: %s",
  (command) =>
    Effect.gen(function* () {
      assert.isFalse(yield* canAutoApprove(fs, shell(command)));
    }),
);
