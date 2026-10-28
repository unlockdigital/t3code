import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Option from "effect/Option";

import { collectProjectBriefSources, isProjectBriefContextPath } from "./ProjectBriefSources.ts";

it.layer(NodeServices.layer)("ProjectBriefSources", (it) => {
  it.effect("reads only the explicitly selected documentation and bounds its bytes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-brief-sources-" });
      yield* fs.writeFileString(path.join(cwd, "README.md"), "Project mission. ".repeat(1000));
      yield* fs.writeFileString(path.join(cwd, "README.txt"), "ignored alternate README");
      yield* fs.writeFileString(
        path.join(cwd, "package.json"),
        '{"name":"study","description":"Study archive","scripts":{"start":"PRIVATE_SCRIPT"},"homepage":"PRIVATE_URL","dependencies":{"PRIVATE_DEP":"1"}}',
      );
      yield* fs.writeFileString(
        path.join(cwd, "CONTEXT.md"),
        "Documented research emphasis. ".repeat(1000),
      );
      let bytesRead = 0;
      const opened: string[] = [];
      const measuredFileSystem = {
        ...fs,
        open: (filePath: string, options?: Parameters<typeof fs.open>[1]) =>
          fs.open(filePath, options).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                opened.push(filePath);
              }),
            ),
            Effect.map((file) => ({
              ...file,
              stat: file.stat,
              readAlloc: (size: number, options?: FileSystem.File.ReadOptions) =>
                file.readAlloc(size, options).pipe(
                  Effect.tap((chunk) =>
                    Effect.sync(() => {
                      if (Option.isSome(chunk)) bytesRead += chunk.value.length;
                    }),
                  ),
                ),
            })),
          ),
      };
      const result = yield* collectProjectBriefSources(cwd, "CONTEXT.md").pipe(
        Effect.provideService(FileSystem.FileSystem, measuredFileSystem),
      );
      expect(bytesRead).toBeLessThanOrEqual(4 * 1024);
      expect(result.sources).toEqual(["CONTEXT.md"]);
      expect(result.canonicalRoot).toBe(yield* fs.realPath(cwd));
      expect(new TextEncoder().encode(result.text).length).toBeLessThanOrEqual(4 * 1024);
      expect(result.text).toContain("Documented research emphasis");
      expect(opened).toEqual([yield* fs.realPath(path.join(cwd, "CONTEXT.md"))]);
      expect(result.text).not.toMatch(/PRIVATE_|ignored alternate/);
    }),
  );

  it.effect(
    "rejects symlinks escaping the root and binary sources without reading alternate names",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-brief-root-" });
        const outside = yield* fs.makeTempDirectoryScoped({ prefix: "t3-brief-outside-" });
        yield* fs.writeFileString(
          path.join(outside, "outside.md"),
          "Private external project mission.",
        );
        yield* fs.symlink(path.join(outside, "outside.md"), path.join(cwd, "README.md"));
        yield* fs.writeFileString(
          path.join(cwd, "README.txt"),
          "Alternate project description must stay unselected.",
        );
        expect((yield* collectProjectBriefSources(cwd).pipe(Effect.flip)).message).toContain(
          "insufficient",
        );
        yield* fs.remove(path.join(cwd, "README.md"));
        yield* fs.writeFile(path.join(cwd, "README.md"), new Uint8Array([65, 0, 66]));
        expect((yield* collectProjectBriefSources(cwd).pipe(Effect.flip)).message).toContain(
          "insufficient",
        );
        expect(
          (yield* collectProjectBriefSources(cwd, "README.md").pipe(Effect.flip)).message,
        ).toContain("context file");
      }),
  );

  it.effect("ignores manifests and suggests documentation for insufficient evidence", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-brief-empty-" });
      yield* fs.writeFileString(
        path.join(cwd, "package.json"),
        '{"description":"' + "a".repeat(10_000),
      );
      expect((yield* collectProjectBriefSources(cwd).pipe(Effect.flip)).message).toContain(
        "Markdown file",
      );
    }),
  );
  it.effect("reads only the default README and leaves secrets, source and manifests unopened", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fs.makeTempDirectoryScoped();
      yield* fs.writeFileString(
        path.join(cwd, "README.md"),
        "Public project documentation. ".repeat(1000),
      );
      for (const name of [".env", "package.json", "finance.csv", "main.ts"])
        yield* fs.writeFileString(path.join(cwd, name), "CONFIDENTIAL_MUST_STAY_LOCAL");
      const opened: string[] = [];
      const result = yield* collectProjectBriefSources(cwd).pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fs,
          open: (filePath, options) =>
            fs.open(filePath, options).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  opened.push(filePath);
                }),
              ),
            ),
        }),
      );
      expect(opened).toEqual([yield* fs.realPath(path.join(cwd, "README.md"))]);
      expect(new TextEncoder().encode(result.text).length).toBeLessThanOrEqual(4096);
      expect(result.text).not.toContain("CONFIDENTIAL_MUST_STAY_LOCAL");
    }),
  );

  it.effect.each([
    "-----BEGIN PRIVATE KEY----- synthetic key",
    "sk-proj-" + "SYNTHETIC".repeat(5),
    "github_pat_" + "SYNTHETIC".repeat(5),
    "AKIASYNTHETICKEY00000",
    "postgresql://demo:synthetic-password@db.invalid/demo",
    'API_KEY = "synthetic-credential-value"',
    '"password": "synthetic-password"',
  ])("blocks recognizable credentials without echoing their contents: %s", (credential) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fs.makeTempDirectoryScoped();
      yield* fs.writeFileString(
        path.join(cwd, "README.md"),
        "Public project mission. " + credential,
      );
      const error = yield* collectProjectBriefSources(cwd).pipe(Effect.flip);
      expect(error.detail).toContain("stopped locally");
      expect(error.detail).not.toContain(credential);
    }),
  );

  it.effect(
    "accepts credential placeholders and preserves a reviewed-source escape from a sensitive README",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped();
        yield* fs.writeFileString(
          path.join(cwd, "README.md"),
          'Private mission. PASSWORD="synthetic-sensitive-value"',
        );
        yield* fs.writeFileString(
          path.join(cwd, "BRIEF.md"),
          'A public project description. API_KEY="your-api-key"',
        );
        const result = yield* collectProjectBriefSources(cwd, "BRIEF.md");
        expect(result.sources).toEqual(["BRIEF.md"]);
        expect(result.text).not.toContain("synthetic-sensitive-value");
      }),
  );
});

it("accepts visible Markdown context paths and excludes traversal, hidden and credential paths", () => {
  expect(isProjectBriefContextPath("research/project-mission.md")).toBe(true);
  for (const value of [
    "../outside.md",
    "/absolute.md",
    ".private/context.md",
    "keys/secret.md",
    "context.txt",
    "C:\\private.md",
  ]) {
    expect(isProjectBriefContextPath(value)).toBe(false);
  }
});
