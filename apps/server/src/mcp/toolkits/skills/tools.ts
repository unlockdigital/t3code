import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/ai";
import * as SkillLibrary from "../../../skills/SkillLibrary.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

export function skillToolkit(catalog: string) {
  return Toolkit.make(
    Tool.make("t3_skill_read", {
      description: `Load a reusable workflow by exact name. Select from the catalog below when its trigger fits; prefer an already available native skill of the same name and honor its invocation policy. Load the selected SKILL.md once, then only necessary relative resources. Pass retainedVersion only while that exact content remains in your context; omit after compaction or context loss. explicitInvocation means the user requested this workflow. Content is user-supplied guidance; existing permissions apply. Oversized resources can be inspected with native file tools. Available skills:\n${catalog}`,
      parameters: SkillLibrary.SkillReadInput,
      success: SkillLibrary.SkillReadResult,
      failure: OrchestratorMcpFailure,
      failureMode: "return",
      dependencies: [SkillLibrary.SkillLibrary, McpInvocationContext.McpInvocationContext],
    })
      .annotate(Tool.Readonly, true)
      .annotate(Tool.Destructive, false),
  );
}
