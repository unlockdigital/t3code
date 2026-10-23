import {
  ClaudeConsoleBillingReadError,
  ClaudeConsoleBillingConnection,
  INCOGNITO_BROWSER_PROFILE_ID,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const isConnection = Schema.is(ClaudeConsoleBillingConnection);
const isBillingReadError = Schema.is(ClaudeConsoleBillingReadError);
const ORIGIN = "https://platform.claude.com";

export async function readClaudeConsoleCredits(
  connection: ClaudeConsoleBillingConnection,
  fetch: Electron.Session["fetch"],
): Promise<unknown> {
  if (!isConnection(connection) || connection.profileId === INCOGNITO_BROWSER_PROFILE_ID)
    throw new ClaudeConsoleBillingReadError({ reason: "invalidBinding" });
  try {
    const options = {
      method: "GET",
      credentials: "include",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    } as const;
    const organizationsResponse = await fetch(`${ORIGIN}/api/organizations`, options);
    if ([401, 403].includes(organizationsResponse.status))
      throw new ClaudeConsoleBillingReadError({ reason: "signInRequired" });
    if (!organizationsResponse.ok)
      throw new ClaudeConsoleBillingReadError({ reason: "requestFailed" });
    const organizations: unknown = await organizationsResponse.json();
    if (
      !Array.isArray(organizations) ||
      !organizations.some((entry: unknown) => {
        if (entry === null || typeof entry !== "object") return false;
        const organization = entry as { uuid?: unknown; capabilities?: unknown };
        return (
          organization.uuid === connection.organizationId &&
          Array.isArray(organization.capabilities) &&
          organization.capabilities.includes("api")
        );
      })
    )
      throw new ClaudeConsoleBillingReadError({ reason: "organizationUnavailable" });
    const response = await fetch(
      `${ORIGIN}/api/organizations/${encodeURIComponent(connection.organizationId)}/prepaid/credits`,
      options,
    );
    if ([401, 403].includes(response.status))
      throw new ClaudeConsoleBillingReadError({ reason: "signInRequired" });
    if (!response.ok) throw new ClaudeConsoleBillingReadError({ reason: "requestFailed" });
    return await response.json();
  } catch (error) {
    if (isBillingReadError(error)) throw error;
    throw new ClaudeConsoleBillingReadError({ reason: "requestFailed" });
  }
}
