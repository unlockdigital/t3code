import { describe, expect, it } from "vite-plus/test";
import { makeProviderSettingsSchema, ProviderDriverKind, TrimmedString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { providerClients } from "./providerDriverMeta";
import {
  deriveProviderSettingsFields,
  nextProviderConfigWithFieldValue,
} from "./ProviderSettingsForm";

describe("ProviderSettingsForm helpers", () => {
  it("offers Tinfoil billing secrets only to a compatible backend and Tinfoil connection", () => {
    const opencode = providerClients.get(ProviderDriverKind.make("opencode"))!;
    const tinfoil = { customModels: ["tinfoil/llama3-3-70b"] };
    expect(deriveProviderSettingsFields(opencode, tinfoil).map((field) => field.key)).not.toContain(
      "tinfoilAdminKey",
    );
    expect(
      deriveProviderSettingsFields(opencode, tinfoil, true).find(
        (field) => field.key === "tinfoilAdminKey",
      ),
    ).toMatchObject({ secret: true, control: "password" });
    expect(
      deriveProviderSettingsFields(opencode, { customModels: ["opencode/gpt-5"] }, true).map(
        (field) => field.key,
      ),
    ).not.toContain("tinfoilAdminKey");
  });

  it("keeps every masked field as a stored secret", () => {
    const settingsSchema = makeProviderSettingsSchema({
      token: TrimmedString.pipe(
        Schema.annotateKey({ providerSettingsForm: { control: "password" } }),
      ),
    });

    expect(deriveProviderSettingsFields({ settingsSchema })).toMatchObject([
      { key: "token", secret: true },
    ]);
  });

  it("preserves unknown config keys while omitting empty configurable fields", () => {
    const opencode = providerClients.get(ProviderDriverKind.make("opencode"));
    expect(opencode).toBeDefined();

    const serverUrl = deriveProviderSettingsFields(opencode!).find(
      (field) => field.key === "serverUrl",
    );
    expect(serverUrl).toBeDefined();

    const next = nextProviderConfigWithFieldValue(
      { forkOwned: 1, serverUrl: "http://127.0.0.1:4096" },
      serverUrl!,
      "",
    );

    expect(next).toEqual({ forkOwned: 1 });
  });

  it("stores false boolean fields when true is the default", () => {
    const next = nextProviderConfigWithFieldValue(
      undefined,
      {
        key: "experimental",
        control: "switch",
        label: "Experimental",
        clearWhenEmpty: "omit",
        defaultBooleanValue: true,
      },
      false,
    );

    expect(next).toEqual({ experimental: false });
  });
});
