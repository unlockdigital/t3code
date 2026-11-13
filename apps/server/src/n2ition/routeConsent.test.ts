import { expect, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import type { N2itionInferenceIdentity } from "@t3tools/contracts/n2itionConnection";
import { n2itionResolvedModel, n2itionVerifiedRouteBinding } from "./routeConsent.ts";

const identity: N2itionInferenceIdentity = {
  version: 1,
  upstreamProvider: "openai-codex",
  upstreamModel: "gpt-6.1-sol",
  endpoint: "https://chatgpt.com/backend-api/codex",
  profileHome: "/owner/hermes",
  credentialSource: "/owner/hermes/auth.json:singleton",
  accountHash: "a".repeat(64),
  runtimePolicyHash: "b".repeat(64),
};
const thread = {
  projectId: ProjectId.make("project"),
  privateModelRoute: undefined,
  modelSelection: {
    instanceId: ProviderInstanceId.make("hermes"),
    model: "openai-codex:gpt-6.1-sol",
  },
};
it("accepts only a resolved model agreeing with the verified runtime", () => {
  expect(n2itionResolvedModel("default", identity)).toBeNull();
  expect(n2itionResolvedModel("auto", identity)).toBeNull();
  expect(n2itionResolvedModel("gpt-6.1-sol", identity)).toBe("gpt-6.1-sol");
  expect(n2itionResolvedModel("openai-codex:gpt-6.1-sol", identity)).toBe("gpt-6.1-sol");
  expect(n2itionResolvedModel("other:gpt-6.1-sol", identity)).toBeNull();
  expect(n2itionResolvedModel("gpt-6-luna", identity)).toBeNull();
});
it("preserves verified identity through qualified reasoning changes and resolved aliases", () => {
  const original = n2itionVerifiedRouteBinding(DEFAULT_SERVER_SETTINGS, thread, identity, [
    "/auth",
  ]);
  const changed = n2itionVerifiedRouteBinding(
    DEFAULT_SERVER_SETTINGS,
    {
      ...thread,
      modelSelection: {
        ...thread.modelSelection,
        model: "gpt-6.1-sol",
        options: [{ id: "reasoningEffort", value: "low" }],
      },
    },
    identity,
    ["/auth"],
  );
  expect(changed).toEqual(original);
});
it("retains account, source, policy, project and unknown-option boundaries", () => {
  const original = n2itionVerifiedRouteBinding(DEFAULT_SERVER_SETTINGS, thread, identity, [
    "/auth",
  ]);
  for (const changed of [
    { ...identity, accountHash: "c".repeat(64) },
    { ...identity, credentialSource: "/other/auth.json:singleton" },
    { ...identity, runtimePolicyHash: "d".repeat(64) },
  ])
    expect(
      n2itionVerifiedRouteBinding(DEFAULT_SERVER_SETTINGS, thread, changed, ["/auth"]),
    ).not.toEqual(original);
  expect(
    n2itionVerifiedRouteBinding(
      DEFAULT_SERVER_SETTINGS,
      {
        ...thread,
        projectId: ProjectId.make("other"),
      },
      identity,
      ["/auth"],
    ),
  ).not.toEqual(original);
  expect(
    n2itionVerifiedRouteBinding(
      DEFAULT_SERVER_SETTINGS,
      {
        ...thread,
        modelSelection: {
          ...thread.modelSelection,
          options: [{ id: "unknownPolicy", value: "changed" }],
        },
      },
      identity,
      ["/auth"],
    ),
  ).not.toEqual(original);
});
