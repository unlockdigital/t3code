import * as NodeAssert from "node:assert/strict";

import { T3_CODE_DEVICE_TOOL_INSTRUCTIONS } from "@t3tools/provider-core/server/orchestrationInstructions";
import { describe, it } from "vite-plus/test";

import {
  buildCodexAdditionalContext,
  CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES,
} from "./CodexDeveloperInstructions.ts";

describe("buildCodexAdditionalContext", () => {
  describe.each([
    { model: "custom-model", modelName: "Custom 🦊 Model", reasoningEffort: "xhigh" },
  ])("with runtime $model", (runtime) => {
    it.each([undefined, { browser: true, device: true }])(
      "keeps every entry within Codex's per-entry cap with tools %j",
      (availability) => {
        const context = buildCodexAdditionalContext(runtime, availability);

        for (const [key, entry] of Object.entries(context)) {
          // Codex counts ceil(UTF-8 bytes / 4) tokens, excluding keys and wrappers.
          const bytes = Buffer.byteLength(entry.value, "utf8");
          const limit = CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES;
          NodeAssert.ok(
            bytes <= limit,
            `${key}: ${bytes} UTF-8 bytes exceeds Codex's ${limit}-byte per-entry cap by ${bytes - limit} bytes; split the instructions into separate entries to avoid silent truncation`,
          );
        }
      },
    );
  });
});

describe("Codex runtime context", () => {
  it("describes Markdown media support in the runtime context in both modes", () => {
    {
      const instructions = runtimeInstructions({
        model: "gpt-5.3-codex",
        reasoningEffort: "high",
      });
      NodeAssert.match(
        instructions,
        /<runtime_info>.*embed images, video, and audio.*Markdown image syntax with absolute file paths.*Link any other file.*absolute path.*files viewer.*<\/runtime_info>/,
      );
    }
  });

  it("flattens multiline metadata into single-line runtime info", () => {
    const instructions = runtimeInstructions({
      model: "gpt\n5.3\ncodex",
      reasoningEffort: " high\neffort ",
    });

    NodeAssert.match(instructions, /as gpt 5\.3 codex with high effort reasoning effort/);
    NodeAssert.doesNotMatch(instructions, /<runtime_info>[^<]*\n/);
  });
});

describe("Codex orchestration context", () => {
  it("preserves model selection, options, and delegated review boundaries", () => {
    const orchestration = Object.entries(buildCodexAdditionalContext({ model: "gpt-6.1-sol" }))
      .filter(([key]) => key.startsWith("t3_code_orchestration_"))
      .map(([, entry]) => entry.value)
      .join("\n");

    NodeAssert.match(
      orchestration,
      /native subagent tools.*same-provider.*chosen model.*no model options/s,
    );
    NodeAssert.match(orchestration, /`delegate_task`.*native tools cannot/s);
    NodeAssert.match(orchestration, /`delegate_task`.*cross-provider.*explicitly T3-owned/s);
    NodeAssert.match(orchestration, /`inheritedOptions`.*`target.options`/s);
    NodeAssert.match(orchestration, /delegated review round, call `delegate_task` again/);
    NodeAssert.match(orchestration, /Do not use `t3_thread_send` on `childThreadId`/);
    NodeAssert.match(orchestration, /only when the user explicitly asks for separate\/new/);
    NodeAssert.match(orchestration, /distinct `clientRequestId` per round, stable across retries/);
    NodeAssert.match(orchestration, /run_in_background:false/);
    NodeAssert.match(orchestration, /Do not poll.*task_status/s);
    NodeAssert.match(orchestration, /task_cancel.*start no replacement/s);
    NodeAssert.match(orchestration, /child, do the work yourself/);
    // The ACP transport fallback belongs to ACP sessions.
    NodeAssert.doesNotMatch(orchestration, /acp-mcp-call/);
  });
});

describe("Codex device context", () => {
  it("adds the shared device block only when the session holds device access", () => {
    const tools = (device: boolean) =>
      buildCodexAdditionalContext({ model: "gpt-6.1-sol" }, { browser: true, device }).t3_code_tools
        ?.value ?? "";

    NodeAssert.ok(tools(true).includes(T3_CODE_DEVICE_TOOL_INSTRUCTIONS));
    NodeAssert.ok(!tools(true).includes("ToolSearch"));
    NodeAssert.ok(!tools(false).includes("## T3 Code devices"));
  });
});

function runtimeInstructions(runtime: Parameters<typeof buildCodexAdditionalContext>[0]) {
  return buildCodexAdditionalContext(runtime).t3_code_runtime!.value;
}
