import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  ACCOUNT_ROUTING_MAX_STAGES,
  AccountRoutingPolicy,
  AccountRoutingPreviewInput,
  AccountRoutingPreviewResult,
} from "./accountRouting.ts";

const policy = {
  schemaVersion: 1,
  policyId: "codex-default",
  revision: 1,
  mode: "observe",
  modelMatch: "exact",
  stages: [
    { id: "lab-included", instanceId: "codex-secondary", fundingIntent: "includedOnly" },
    { id: "ud-included", instanceId: "codex", fundingIntent: "includedOnly" },
    { id: "lab-credits", instanceId: "codex-secondary", fundingIntent: "creditsAllowed" },
    { id: "ud-credits", instanceId: "codex", fundingIntent: "creditsAllowed" },
  ],
  maxEvidenceAgeSeconds: 300,
  minimumHeadroomPercent: 5,
  paidApiFallback: false,
};
const decodePolicy = Schema.decodeUnknownSync(AccountRoutingPolicy);
const encodePolicy = Schema.encodeSync(AccountRoutingPolicy);
const request = {
  projectId: "project-1",
  requestedSelection: {
    instanceId: "codex",
    model: "gpt-6.1-sol",
    options: [{ id: "reasoningEffort", value: "max" }],
  },
};

describe("AccountRoutingPolicy", () => {
  it("round trips the reviewed four-stage policy", () => {
    const decoded = decodePolicy(policy);
    expect(encodePolicy(decoded)).toEqual(policy);
  });

  it.each([
    { revision: 0 },
    { revision: Number.MAX_SAFE_INTEGER + 1 },
    { schemaVersion: 2 },
    { modelMatch: "family" },
    { mode: "auto" },
    { paidApiFallback: true },
    { maxEvidenceAgeSeconds: 0 },
    { maxEvidenceAgeSeconds: 86_401 },
    { maxEvidenceAgeSeconds: 1.5 },
    { maxEvidenceAgeSeconds: Number.POSITIVE_INFINITY },
    { minimumHeadroomPercent: Number.NaN },
    { minimumHeadroomPercent: Number.POSITIVE_INFINITY },
    { minimumHeadroomPercent: -1 },
    { minimumHeadroomPercent: 101 },
    { policyId: "a".repeat(65) },
    { policyId: "/home/account" },
    { stages: [] },
  ])("rejects invalid policy fields: %j", (patch) => {
    expect(() => decodePolicy({ ...policy, ...patch })).toThrow();
  });

  it("bounds stage counts, stable IDs, and instance IDs", () => {
    expect(() =>
      decodePolicy({
        ...policy,
        stages: Array.from({ length: ACCOUNT_ROUTING_MAX_STAGES + 1 }, (_, index) => ({
          id: `stage-${index}`,
          instanceId: "account-a",
          fundingIntent: "includedOnly",
        })),
      }),
    ).toThrow();
    for (const stage of [
      { ...policy.stages[0], id: " " },
      { ...policy.stages[0], id: "a".repeat(65) },
      { ...policy.stages[0], instanceId: "a".repeat(65) },
    ]) {
      expect(() => decodePolicy({ ...policy, stages: [stage] })).toThrow();
    }
  });

  it("rejects duplicate IDs and credit stages before included stages", () => {
    expect(() =>
      decodePolicy({ ...policy, stages: [policy.stages[0], policy.stages[0]] }),
    ).toThrow();
    expect(() =>
      decodePolicy({ ...policy, stages: [policy.stages[2], policy.stages[0]] }),
    ).toThrow();
    expect(() => decodePolicy({ ...policy, stages: [policy.stages[2]] })).toThrow();
    expect(() =>
      decodePolicy({ ...policy, stages: [policy.stages[0], policy.stages[2], policy.stages[1]] }),
    ).toThrow();
  });

  it("accepts included-only policies and finite fractional headroom", () => {
    expect(
      decodePolicy({ ...policy, stages: policy.stages.slice(0, 2), minimumHeadroomPercent: 2.5 })
        .minimumHeadroomPercent,
    ).toBe(2.5);
  });
});

describe("AccountRoutingPreviewInput", () => {
  const decode = Schema.decodeUnknownSync(AccountRoutingPreviewInput);

  it("accepts exact options and explicit account/private-route constraints", () => {
    const input = {
      ...request,
      threadId: "thread-1",
      pinnedInstanceId: "codex-secondary",
      requirePrivateRoute: true,
    };
    expect(decode(input)).toEqual(input);
  });

  it("keeps caller-supplied evidence outside the decoded input", () => {
    expect(
      decode({ ...request, candidates: [{ authenticated: true }], creditBalance: 100 }),
    ).toEqual(request);
  });

  it("rejects duplicate options and bounded request overflows", () => {
    for (const requestedSelection of [
      { ...request.requestedSelection, model: "m".repeat(257) },
      {
        ...request.requestedSelection,
        options: [
          { id: "effort", value: "max" },
          { id: "effort", value: "low" },
        ],
      },
      { ...request.requestedSelection, options: [{ id: "i".repeat(65), value: true }] },
      { ...request.requestedSelection, options: [{ id: "effort", value: "v".repeat(257) }] },
      {
        ...request.requestedSelection,
        options: Array.from({ length: 33 }, (_, index) => ({ id: `option-${index}`, value: true })),
      },
    ]) {
      expect(() => decode({ ...request, requestedSelection })).toThrow();
    }
    expect(() => decode({ ...request, projectId: "p".repeat(129) })).toThrow();
    expect(() => decode({ ...request, threadId: "t".repeat(129) })).toThrow();
  });
});

it("keeps every preview mode incapable of dispatch authorization", () => {
  const decode = Schema.decodeUnknownSync(AccountRoutingPreviewResult);
  const result = {
    status: "blocked",
    evaluatedAt: "2026-10-24T12:00:00.000Z",
    mode: "enforce",
    requestedSelection: request.requestedSelection,
    target: null,
    selectedStageId: null,
    reasons: ["noEligibleStage"],
    stages: [],
    nextRefreshAt: null,
    dispatchAllowed: false,
    activationBlockers: ["previewOnly"],
    policySnapshot: { ...policy, mode: "enforce" },
  };
  expect(decode(result).dispatchAllowed).toBe(false);
  expect(() => decode({ ...result, dispatchAllowed: true })).toThrow();
});
