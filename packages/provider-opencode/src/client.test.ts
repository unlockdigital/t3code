import { describe, expect, it } from "vite-plus/test";
import { resolveProviderIcon } from "@t3tools/provider-core/client";

import { openCodeClient } from "./client.ts";

describe("OpenCode provider instance branding", () => {
  it("uses the Tinfoil mark for its connector instance", () => {
    const icon = resolveProviderIcon(openCodeClient, "opencode-tinfoil");
    expect(icon?.viewBox).toBe("0 0 960 960");
    expect(icon?.fill).toEqual({ light: "#000000", dark: "#ffffff" });
  });

  it("keeps the OpenCode mark for Go and other instances", () => {
    for (const instanceId of ["opencode-go", "opencode", "another-account", undefined]) {
      expect(resolveProviderIcon(openCodeClient, instanceId)).toBe(openCodeClient.icon);
    }
  });

  it("falls back safely for object prototype names and missing drivers", () => {
    expect(resolveProviderIcon(openCodeClient, "toString")).toBe(openCodeClient.icon);
    expect(resolveProviderIcon(undefined, "opencode-tinfoil")).toBeUndefined();
  });
});
