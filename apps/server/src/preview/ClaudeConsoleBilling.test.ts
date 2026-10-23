import { describe, expect, it, vi } from "vite-plus/test";
import type { BrowserContext, Page } from "playwright-core";
import { isClaudeBillingReadRequest, readClaudeConsoleCredits } from "./ClaudeConsoleBilling.ts";

const organizationId = "11111111-1111-4111-8111-111111111111";
const connection = { profileId: "default", organizationId };
function fixture() {
  const page = {
    route: vi.fn(async () => {}),
    goto: vi.fn(async () => {}),
    evaluate: vi.fn(async (run: (id: string) => Promise<unknown>, id: string) => run(id)),
    close: vi.fn(async () => {}),
  };
  const context = {
    newPage: vi.fn(async () => page as unknown as Page),
    newCDPSession: vi.fn(async () => ({
      send: async () => ({ userAgent: "Synthetic Chrome" }),
      detach: async () => {},
    })),
    cookies: vi.fn(() => {
      throw new Error("Cookie export is forbidden");
    }),
  };
  return { page, context: context as unknown as BrowserContext, cookies: context.cookies };
}

describe("Claude Console browser billing boundary", () => {
  it("permits only HTTPS GETs to the Console origin", () => {
    expect(isClaudeBillingReadRequest("GET", "https://platform.claude.com/api/organizations")).toBe(
      true,
    );
    for (const [method, url] of [
      ["POST", "https://platform.claude.com/api/organizations"],
      ["GET", "https://platform.claude.com.evil.invalid/api/organizations"],
      ["GET", "http://platform.claude.com/api/organizations"],
      ["GET", "https://unrelated.invalid/"],
    ])
      expect(isClaudeBillingReadRequest(method!, url!)).toBe(false);
  });
  it("reads the exact API organization with in-browser credentials and closes only its own page", async () => {
    const f = fixture();
    using fetch = vi.spyOn(globalThis, "fetch");
    fetch
      .mockResolvedValueOnce(
        Response.json([
          { uuid: "22222222-2222-4222-8222-222222222222", capabilities: ["chat"] },
          { uuid: organizationId, capabilities: ["api"] },
        ]),
      )
      .mockResolvedValueOnce(Response.json({ currency: "USD", amount: 7310 }));
    const result = await readClaudeConsoleCredits(f.context, connection, {
      platform: "linux",
      arch: "x64",
    });
    expect(result).toEqual({ currency: "USD", amount: 7310 });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://platform.claude.com/api/organizations",
      `https://platform.claude.com/api/organizations/${organizationId}/prepaid/credits`,
    ]);
    for (const [, options] of fetch.mock.calls)
      expect(options).toMatchObject({
        method: "GET",
        credentials: "same-origin",
        redirect: "error",
      });
    expect(f.cookies).not.toHaveBeenCalled();
    expect(f.page.close).toHaveBeenCalledOnce();
  });
  it("rejects subscription organizations before requesting a balance", async () => {
    const f = fixture();
    using fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json([{ uuid: organizationId, capabilities: ["chat"] }]));
    await expect(
      readClaudeConsoleCredits(f.context, connection, { platform: "linux", arch: "x64" }),
    ).rejects.toMatchObject({ reason: "organizationUnavailable" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(f.page.close).toHaveBeenCalledOnce();
  });
  it("reports expired sign-in without retaining private response contents", async () => {
    const f = fixture();
    using _fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({ privateAccountData: "synthetic secret text" }, { status: 403 }),
      );
    await expect(
      readClaudeConsoleCredits(f.context, connection, { platform: "linux", arch: "x64" }),
    ).rejects.toMatchObject({ reason: "signInRequired" });
    expect(f.page.close).toHaveBeenCalledOnce();
  });
});
