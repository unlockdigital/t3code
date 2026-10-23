import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { OpenCodeSettings } from "../settings.ts";
import { privateInferenceEnvironment } from "./privateInference.ts";
const decodeSettings = Schema.decodeSync(OpenCodeSettings);

it("replaces inherited cloud routing and disables project configuration for private inference", () => {
  const config = decodeSettings({ privateInference: "tinfoil" });
  const result = privateInferenceEnvironment(
    {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        model: "cloud/secret",
        provider: { tinfoil: { options: { baseURL: "https://example.invalid" } } },
      }),
      OPENCODE_DISABLE_PROJECT_CONFIG: "0",
    },
    config,
  );
  const inline = JSON.parse(result.OPENCODE_CONFIG_CONTENT!);
  expect(inline.model).toBe("tinfoil/kimi-k3");
  expect(inline.provider.tinfoil.options.baseURL).toBe("http://127.0.0.1:3301/v1");
  expect(inline.enabled_providers).toEqual(["tinfoil"]);
  expect(inline.policies).toEqual([
    { action: "provider.use", resource: "*", effect: "deny" },
    { action: "provider.use", resource: "tinfoil", effect: "allow" },
  ]);
  expect(result.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("1");
  expect(result.OPENCODE_PURE).toBe("1");
  expect(inline.agents.title.model).toBe(inline.model);
  expect(inline.agents.summary.model).toBe(inline.model);
  expect(inline.agents.compaction.model).toBe(inline.model);
  expect(inline.provider.tinfoil.options.apiKey).toBe("{env:TINFOIL_API_KEY}");
});

it("preserves ordinary subscription configuration", () => {
  const environment = { OPENCODE_CONFIG_CONTENT: "subscription-config" };
  expect(privateInferenceEnvironment(environment, decodeSettings({}))).toBe(environment);
});
