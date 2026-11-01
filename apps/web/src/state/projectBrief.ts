import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";

export const projectBrief = {
  get: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:projects:get-brief",
    tag: WS_METHODS.projectsGetBrief,
  }),
  generate: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:projects:generate-brief",
    tag: WS_METHODS.projectsGenerateBrief,
  }),
  clear: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:projects:clear-brief",
    tag: WS_METHODS.projectsClearBrief,
  }),
  configure: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:projects:configure-brief",
    tag: WS_METHODS.projectsConfigureBrief,
  }),
};
