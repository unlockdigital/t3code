import {
  AccountRoutingPreviewInput,
  AccountRoutingPreviewResult,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/ai";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as AccountRouting from "../../../provider/AccountRoutingService.ts";
import * as Settings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

export const AccountRoutingToolkit = Toolkit.make(
  Tool.make("account_routing_preview", {
    description:
      "Preview account selection for the exact model and options in this thread's project. Reads cached evidence and the versioned policy; reports missing evidence and activation blockers. Phase 1 always returns dispatchAllowed=false. Account switching, purchases, and provider requests require separate actions.",
    parameters: AccountRoutingPreviewInput,
    success: AccountRoutingPreviewResult,
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies: [
      AccountRouting.AccountRoutingService,
      ThreadManagement.ThreadManagementService,
      Settings.ServerSettingsService,
      McpInvocationContext.McpInvocationContext,
    ],
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
);
