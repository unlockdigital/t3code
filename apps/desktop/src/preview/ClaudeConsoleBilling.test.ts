import { describe, expect, it, vi } from "vite-plus/test";
import { readClaudeConsoleCredits } from "./ClaudeConsoleBilling.ts";

const organizationId = "11111111-1111-4111-8111-111111111111";
const connection = { profileId: "default", organizationId };

describe("desktop Claude Console billing", () => {
  it("reads only the bound API organization's credits through its existing session", async () => {
    const fetch = vi
      .fn<Electron.Session["fetch"]>()
      .mockResolvedValueOnce(
        Response.json([
          { uuid: "22222222-2222-4222-8222-222222222222", capabilities: ["chat"] },
          { uuid: organizationId, capabilities: ["api"] },
        ]),
      )
      .mockResolvedValueOnce(Response.json({ currency: "USD", amount: 7310 }));
    expect(await readClaudeConsoleCredits(connection, fetch)).toEqual({
      currency: "USD",
      amount: 7310,
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://platform.claude.com/api/organizations",
      `https://platform.claude.com/api/organizations/${organizationId}/prepaid/credits`,
    ]);
    for (const [, options] of fetch.mock.calls)
      expect(options).toMatchObject({ method: "GET", credentials: "include", redirect: "error" });
  });
  it("rejects subscription organizations before requesting a balance", async () => {
    const fetch = vi
      .fn<Electron.Session["fetch"]>()
      .mockResolvedValueOnce(Response.json([{ uuid: organizationId, capabilities: ["chat"] }]));
    await expect(readClaudeConsoleCredits(connection, fetch)).rejects.toMatchObject({
      reason: "organizationUnavailable",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("reports a sign-in requirement without exposing private response contents", async () => {
    const fetch = vi
      .fn<Electron.Session["fetch"]>()
      .mockResolvedValueOnce(
        Response.json({ privateData: "invented confidential text" }, { status: 403 }),
      );
    await expect(readClaudeConsoleCredits(connection, fetch)).rejects.toMatchObject({
      reason: "signInRequired",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("rejects incognito profiles and malformed organization bindings without network access", async () => {
    const fetch = vi.fn<Electron.Session["fetch"]>();
    for (const input of [
      { ...connection, profileId: "incognito" },
      { ...connection, organizationId: "../unrelated" },
    ])
      await expect(readClaudeConsoleCredits(input, fetch)).rejects.toMatchObject({
        reason: "invalidBinding",
      });
    expect(fetch).not.toHaveBeenCalled();
  });
});
