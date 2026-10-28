import { expect, it } from "@effect/vitest";

import * as ProjectLaunchPolicy from "./ProjectLaunchPolicy.ts";

const policy = {
  version: 1,
  protectedProjectIds: ["project:protected-fixture"],
  allowedTargetProjectIds: ["project:approved-fixture"],
};

it("decodes policy project selections and target grants", () => {
  const decoded = ProjectLaunchPolicy.decode(policy);
  expect(decoded?.protectedProjectIds.has("project:protected-fixture")).toBe(true);
  expect(decoded?.allowedTargetProjectIds.has("project:approved-fixture")).toBe(true);
});

it("rejects malformed and ambiguous policy entries", () => {
  for (const malformed of [
    null,
    [],
    { ...policy, version: 2 },
    { ...policy, protectedProjectIds: ["project:protected-fixture", "project:protected-fixture"] },
    { ...policy, allowedTargetProjectIds: [" project:approved-fixture"] },
    { version: 1, protectedProjectIds: ["project:protected-fixture"] },
  ]) {
    expect(ProjectLaunchPolicy.decode(malformed)).toBeUndefined();
  }
});
