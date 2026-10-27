import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type ProviderInstanceConfigMap,
} from "@t3tools/contracts";

// Settings validation and registry hydration share these implicit instances without
// loading provider runtimes into the settings service.
export const DEFAULT_PROVIDER_INSTANCES: ProviderInstanceConfigMap = Object.fromEntries(
  ["codex", "claudeAgent", "cursor", "grok", "opencode", "antigravity", "pi", "muse"].map(
    (kind) => {
      const driver = ProviderDriverKind.make(kind);
      return [defaultInstanceIdForDriver(driver), { driver }];
    },
  ),
);
