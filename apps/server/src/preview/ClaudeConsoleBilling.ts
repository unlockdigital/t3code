// @effect-diagnostics globalFetch:off - fetch executes inside Chromium using its existing session cookies.
import { ClaudeConsoleBillingConnection, ClaudeConsoleBillingReadError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { BrowserContext } from "playwright-core";
import { presentAsChrome } from "./ServerBrowserContexts.ts";

const ORIGIN = "https://platform.claude.com";
const isConnection = Schema.is(ClaudeConsoleBillingConnection);
const isBillingReadError = Schema.is(ClaudeConsoleBillingReadError);

export function isClaudeBillingReadRequest(method: string, url: string): boolean {
  try {
    return method === "GET" && new URL(url).origin === ORIGIN;
  } catch {
    return false;
  }
}

export async function readClaudeConsoleCredits(
  context: BrowserContext,
  connection: ClaudeConsoleBillingConnection,
  host: { readonly platform: NodeJS.Platform; readonly arch: string },
): Promise<unknown> {
  if (!isConnection(connection))
    throw new ClaudeConsoleBillingReadError({ reason: "invalidBinding" });
  const page = await context.newPage();
  try {
    // This hidden page is separate from human tabs; credentials remain inside the browser.
    await page.route("**/*", (route) =>
      isClaudeBillingReadRequest(route.request().method(), route.request().url())
        ? route.continue()
        : route.abort(),
    );
    const cdp = await context.newCDPSession(page);
    try {
      await presentAsChrome(cdp, host);
    } finally {
      await cdp.detach();
    }
    await page.goto(`${ORIGIN}/settings/billing`, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    const result = await page.evaluate(async (organizationId) => {
      const options = {
        method: "GET",
        credentials: "same-origin",
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      } as const;
      const organizationsResponse = await fetch(
        "https://platform.claude.com/api/organizations",
        options,
      );
      if ([401, 403].includes(organizationsResponse.status))
        return { reason: "signInRequired" } as const;
      if (!organizationsResponse.ok) return { reason: "requestFailed" } as const;
      const organizations: unknown = await organizationsResponse.json();
      const matches =
        Array.isArray(organizations) &&
        organizations.some((candidate: unknown) => {
          if (candidate === null || typeof candidate !== "object") return false;
          const row = candidate as { uuid?: unknown; capabilities?: unknown };
          return (
            row.uuid === organizationId &&
            Array.isArray(row.capabilities) &&
            row.capabilities.includes("api")
          );
        });
      if (!matches) return { reason: "organizationUnavailable" } as const;
      const response = await fetch(
        `https://platform.claude.com/api/organizations/${encodeURIComponent(organizationId)}/prepaid/credits`,
        options,
      );
      if ([401, 403].includes(response.status)) return { reason: "signInRequired" } as const;
      if (!response.ok) return { reason: "requestFailed" } as const;
      const credits: unknown = await response.json();
      return { credits };
    }, connection.organizationId);
    if ("reason" in result) throw new ClaudeConsoleBillingReadError({ reason: result.reason });
    return result.credits;
  } catch (error) {
    if (isBillingReadError(error)) throw error;
    throw new ClaudeConsoleBillingReadError({ reason: "requestFailed" });
  } finally {
    await page.close().catch(() => {});
  }
}
