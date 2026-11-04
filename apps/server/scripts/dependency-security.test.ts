import { describe, expect, it } from "@effect/vitest";
import { checkDependencySecurity } from "./dependency-security.ts";

const lock = (entries: string) =>
  `lockfileVersion: '9.0'\nimporters: {}\npackages:\n  /bootstrap@1.0.0:\n    version: 1.0.0\n---\nimporters:\n  apps/server: {}\n  apps/desktop: {}\npackages:\n${entries || "  {}"}`;

describe("checkDependencySecurity", () => {
  it("selects the workspace document and checks supported majors and prereleases", () => {
    const result = checkDependencySecurity(
      lock(
        [
          "  /undici@7.29.0:\n    version: 7.29.0",
          "  /@modelcontextprotocol/sdk@1.31.0:\n    version: 1.31.0",
          "  /undici@8.12.2-beta.1:\n    version: 8.12.2-beta.1",
          "  /undici@6.29.1:\n    version: 6.29.1",
          "  /zod@3.25.0:\n    version: 3.25.0",
        ].join("\n"),
      ),
    );
    expect(result.packages).toEqual([
      { name: "undici", version: "7.29.0" },
      { name: "@modelcontextprotocol/sdk", version: "1.31.0" },
      { name: "undici", version: "8.12.2-beta.1" },
      { name: "undici", version: "6.29.1" },
    ]);
    expect(result.violations).toEqual([
      { name: "undici", version: "7.29.0", minimum: "7.30.1" },
      { name: "@modelcontextprotocol/sdk", version: "1.31.0", minimum: "1.32.0" },
      { name: "undici", version: "8.12.2-beta.1", minimum: "8.12.2" },
    ]);
  });

  it("accepts patched versions and permits packages omitted by filtered artifacts", () => {
    expect(
      checkDependencySecurity(lock("  /undici@7.30.1:\n    version: 7.30.1")).violations,
    ).toEqual([]);
    expect(checkDependencySecurity(lock("")).packages).toEqual([]);
  });

  it("rejects a missing workspace document and malformed checked versions", () => {
    expect(() => checkDependencySecurity("importers: {}\npackages: {}\n")).toThrow(
      "exactly one workspace lockfile document",
    );
    expect(() => checkDependencySecurity(lock("  /undici@latest:\n    version: latest"))).toThrow(
      "Malformed resolved version for undici",
    );
  });
});
