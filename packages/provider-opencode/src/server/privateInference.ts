import type { OpenCodeSettings } from "../settings.ts";

export function privateInferenceEnvironment(
  environment: NodeJS.ProcessEnv,
  config: OpenCodeSettings,
): NodeJS.ProcessEnv {
  if (config.privateInference !== "tinfoil") return environment;
  const model = "tinfoil/kimi-k3";
  return {
    ...environment,
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_PURE: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      model,
      small_model: model,
      enabled_providers: ["tinfoil"],
      share: "disabled",
      update: "disable",
      warming: false,
      policies: [
        { action: "provider.use", resource: "*", effect: "deny" },
        { action: "provider.use", resource: "tinfoil", effect: "allow" },
      ],
      provider: {
        tinfoil: {
          npm: "@ai-sdk/openai-compatible",
          name: "Tinfoil",
          options: { baseURL: "http://127.0.0.1:3301/v1", apiKey: "{env:TINFOIL_API_KEY}" },
        },
      },
      agents: { title: { model }, summary: { model }, compaction: { model } },
    }),
  };
}
