import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as ServerConfig from "../config.ts";
import * as SkillLibrary from "./SkillLibrary.ts";

const setup = Effect.fn("SkillLibrary.test.setup")(function* (
  options: { mode?: "auto" | "manual" | "disabled"; content?: string; manifest?: string } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-skills-" });
  const directory = `${root}/workflow`;
  yield* fs.makeDirectory(directory);
  const content =
    options.content ??
    "---\nname: example\ndescription: Test workflow\n---\nRead the current evidence.";
  yield* fs.writeFileString(`${directory}/SKILL.md`, content);
  yield* fs.writeFileString(`${directory}/reference.md`, "Only this reference is needed.");
  yield* fs.writeFileString(`${root}/outside.md`, "Outside registered skill.");
  yield* fs.makeDirectory(`${root}/userdata`);
  yield* fs.writeFileString(
    `${root}/userdata/skills.json`,
    options.manifest ??
      JSON.stringify({
        skills: [
          {
            name: "example",
            description: "Use for evidence review.",
            path: `${directory}/SKILL.md`,
            workingDirectory: root,
            ...(options.mode === undefined ? {} : { mode: options.mode }),
          },
        ],
      }),
  );
  const layer = SkillLibrary.layer.pipe(Layer.provide(ServerConfig.layerTest(root, root)));
  return { fs, root, directory, content, layer };
});

it.effect("advertises only metadata and reads the chosen canonical content and resource", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    yield* Effect.gen(function* () {
      const library = yield* SkillLibrary.SkillLibrary;
      expect(library.catalog).toBe("example: Use for evidence review.");
      expect(library.catalog).not.toContain(fixture.directory);
      const result = yield* library.read({ name: "example" });
      expect(result.content).toBe(fixture.content);
      expect(result.workingDirectory).toBe(fixture.root);
      expect((yield* library.read({ name: "example", resource: "reference.md" })).content).toBe(
        "Only this reference is needed.",
      );
    }).pipe(Effect.provide(fixture.layer));
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("reuses retained content, reloads after context loss, and detects edited sources", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    yield* Effect.gen(function* () {
      const library = yield* SkillLibrary.SkillLibrary;
      const first = yield* library.read({ name: "example" });
      const retained = yield* library.read({ name: "example", retainedVersion: first.version });
      expect(retained.unchanged).toBe(true);
      expect(retained.content).toBe("");
      expect((yield* library.read({ name: "example" })).content).toBe(first.content);
      yield* fixture.fs.writeFileString(`${fixture.directory}/SKILL.md`, "Updated procedure.");
      const updated = yield* library.read({ name: "example", retainedVersion: first.version });
      expect(updated.unchanged).toBe(false);
      expect(updated.content).toBe("Updated procedure.");
      expect(updated.version).not.toBe(first.version);
    }).pipe(Effect.provide(fixture.layer));
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("keeps the catalog available without opening instruction files at startup", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    yield* fixture.fs.remove(`${fixture.directory}/SKILL.md`);
    yield* Effect.gen(function* () {
      const library = yield* SkillLibrary.SkillLibrary;
      expect(library.catalog).toContain("example:");
      expect((yield* library.read({ name: "example" }).pipe(Effect.flip)).reason).toBe("read");
    }).pipe(Effect.provide(fixture.layer));
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("requires an explicit request for manual skills and honors changed source policy", () =>
  Effect.gen(function* () {
    const fixture = yield* setup({ mode: "manual" });
    yield* Effect.gen(function* () {
      const library = yield* SkillLibrary.SkillLibrary;
      expect(library.catalog).toContain("[explicit request]");
      expect((yield* library.read({ name: "example" }).pipe(Effect.flip)).reason).toBe(
        "manual_only",
      );
      expect((yield* library.read({ name: "example", explicitInvocation: true })).content).toBe(
        fixture.content,
      );
    }).pipe(Effect.provide(fixture.layer));
    const automatic = yield* setup();
    yield* Effect.gen(function* () {
      const library = yield* SkillLibrary.SkillLibrary;
      yield* automatic.fs.writeFileString(
        `${automatic.directory}/SKILL.md`,
        "---\ndisable-model-invocation: true\n---\nManual now.",
      );
      for (const resource of [undefined, "./SKILL.md", "reference.md"]) {
        expect(
          (yield* library
            .read({ name: "example", ...(resource === undefined ? {} : { resource }) })
            .pipe(Effect.flip)).reason,
        ).toBe("manual_only");
      }
    }).pipe(Effect.provide(automatic.layer));
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("excludes disabled skills and rejects unknown names", () =>
  Effect.gen(function* () {
    const fixture = yield* setup({ mode: "disabled" });
    yield* Effect.gen(function* () {
      const library = yield* SkillLibrary.SkillLibrary;
      expect(library.catalog).toBe("");
      for (const name of ["example", "missing"]) {
        expect((yield* library.read({ name }).pipe(Effect.flip)).reason).toBe("unknown_skill");
      }
    }).pipe(Effect.provide(fixture.layer));
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("rejects traversal and symlink escapes while allowing in-root references", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    yield* fixture.fs.symlink(`${fixture.root}/outside.md`, `${fixture.directory}/escape.md`);
    yield* Effect.gen(function* () {
      const library = yield* SkillLibrary.SkillLibrary;
      for (const resource of ["../outside.md", "escape.md", `${fixture.root}/outside.md`]) {
        expect((yield* library.read({ name: "example", resource }).pipe(Effect.flip)).reason).toBe(
          "path",
        );
      }
      expect(
        (yield* library.read({ name: "example", resource: "./reference.md" })).content,
      ).toContain("Only this reference");
    }).pipe(Effect.provide(fixture.layer));
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  "rejects oversized instructions and resources without returning truncated procedures",
  () =>
    Effect.gen(function* () {
      const fixture = yield* setup();
      yield* Effect.gen(function* () {
        const library = yield* SkillLibrary.SkillLibrary;
        yield* fixture.fs.writeFileString(`${fixture.directory}/reference.md`, "x".repeat(16_385));
        expect(
          (yield* library.read({ name: "example", resource: "reference.md" }).pipe(Effect.flip))
            .reason,
        ).toBe("size");
        yield* fixture.fs.writeFileString(`${fixture.directory}/SKILL.md`, "x".repeat(32_769));
        expect((yield* library.read({ name: "example" }).pipe(Effect.flip)).reason).toBe("size");
      }).pipe(Effect.provide(fixture.layer));
    }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("invalid or duplicate configuration leaves native skills available", () =>
  Effect.gen(function* () {
    for (const manifest of [
      "{broken",
      JSON.stringify({
        skills: [
          { name: "duplicate", description: "One", path: "/a/SKILL.md" },
          { name: "duplicate", description: "Two", path: "/b/SKILL.md" },
        ],
      }),
    ]) {
      const fixture = yield* setup({ manifest });
      yield* Effect.gen(function* () {
        const library = yield* SkillLibrary.SkillLibrary;
        expect(library.catalog).toBe("");
      }).pipe(Effect.provide(fixture.layer));
    }
  }).pipe(Effect.provide(NodeServices.layer)),
);
