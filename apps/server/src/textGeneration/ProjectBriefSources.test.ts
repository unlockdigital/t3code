import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Option from "effect/Option";

import { collectProjectBriefSources, isProjectBriefContextPath } from "./ProjectBriefSources.ts";

it.layer(NodeServices.layer)("ProjectBriefSources", (it) => {
  it.effect(
    "collects bounded selected sources and excludes manifest commands, links and dependencies",
    () =>
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
        const measuredFileSystem = {
          ...fs,
          open: (filePath: string, options?: Parameters<typeof fs.open>[1]) =>
            fs.open(filePath, options).pipe(
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
        expect(bytesRead).toBeLessThanOrEqual(16 * 1024);
        expect(result.sources).toEqual(["README.md", "package.json", "CONTEXT.md"]);
        expect(result.canonicalRoot).toBe(yield* fs.realPath(cwd));
        expect(new TextEncoder().encode(result.text).length).toBeLessThanOrEqual(16 * 1024);
        expect(result.text).toContain("Study archive");
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

  it.effect(
    "bounds malformed manifests and suggests a context file for insufficient evidence",
    () =>
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
