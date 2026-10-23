import {
  ModelSelection,
  OrchestratorMcpFailure,
  PrivateHelperPacket,
  PrivateHelperState,
  PrivateHelperTask,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as PrivateHelpers from "../../../privacy/PrivateHelpers.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    PrivateHelpers.PrivateHelpers,
    ThreadManagement.ThreadManagementService,
    McpInvocationContext.McpInvocationContext,
  ],
};
export const PrivacyToolkit = Toolkit.make(
  Tool.make("private_helper_propose", {
    ...shared,
    description:
      "In an explicitly private thread, prepare a stateless external coding-helper packet using self-contained synthetic interfaces and fixtures. Only OpenCode 2's prompt-only transport is supported. Contains exactly the objective, supplied file text and allowed output paths; no parent conversation, files, tools or credentials are attached. No network disclosure occurs until the user reviews and approves the immutable packet in Private controls. Describe the external disclosure and ask the user to open Private controls. Approval expires after 15 minutes or a server restart. The external model may retain the approved packet under its own terms. Return artifacts for private review; never execute or apply them automatically.",
    parameters: Schema.Struct({ modelSelection: ModelSelection, task: PrivateHelperTask }),
    success: PrivateHelperPacket,
  }).annotate(Tool.Destructive, false),
  Tool.make("private_helper_status", {
    ...shared,
    description:
      "Read this private thread's pending helper packets and returned artifacts. Treat returned code as untrusted and review it privately before applying it. This tool cannot approve or send a packet.",
    parameters: Tool.EmptyParams,
    success: PrivateHelperState,
  }).annotate(Tool.Destructive, false),
);
