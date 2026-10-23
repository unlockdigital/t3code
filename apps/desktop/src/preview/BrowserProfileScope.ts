import { DEFAULT_BROWSER_PROFILE_ID, INCOGNITO_BROWSER_PROFILE_ID } from "@t3tools/contracts";

export function resolvePartitionScope(
  environmentId: string,
  profileId: string | undefined,
): { readonly scope: string; readonly persistent: boolean; readonly namespace?: "profile" } {
  // Preserve the legacy default partition so existing sign-ins survive profile support.
  if (profileId === undefined || profileId === DEFAULT_BROWSER_PROFILE_ID)
    return { scope: environmentId, persistent: true };
  return {
    scope: JSON.stringify([environmentId, profileId]),
    persistent: profileId !== INCOGNITO_BROWSER_PROFILE_ID,
    namespace: "profile",
  };
}
