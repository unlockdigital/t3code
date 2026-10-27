import { describe, expect, it } from "@effect/vitest";
import {
  AccountRoutingPolicy,
  AccountRoutingPreviewInput,
  AccountRoutingPreviewResult,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";

import {
  type AccountRoutingCandidate,
  type AccountRoutingEvidence,
  type AccountRoutingSelectorInput,
  type AccountRoutingWindow,
  selectAccountRouting,
} from "./accountRouting.ts";

const NOW = Date.parse("2026-10-24T12:00:00.000Z");
const UNKNOWN = { status: "unknown" } as const;
const LAB = ProviderInstanceId.make("codex-secondary");
const UD = ProviderInstanceId.make("codex");
const MODEL = "gpt-6.1-sol";
const OPTIONS = [
  { id: "reasoningEffort", value: "max" },
  { id: "serviceTier", value: "priority" },
  { id: "fastMode", value: false },
];
const POLICY = Schema.decodeSync(AccountRoutingPolicy)({
  schemaVersion: 1,
  policyId: "codex-default",
  revision: 1,
  mode: "observe",
  modelMatch: "exact",
  stages: [
    { id: "lab-included", instanceId: LAB, fundingIntent: "includedOnly" },
    { id: "ud-included", instanceId: UD, fundingIntent: "includedOnly" },
    { id: "lab-credits", instanceId: LAB, fundingIntent: "creditsAllowed" },
    { id: "ud-credits", instanceId: UD, fundingIntent: "creditsAllowed" },
  ],
  maxEvidenceAgeSeconds: 300,
  minimumHeadroomPercent: 5,
  paidApiFallback: false,
});
const REQUEST = Schema.decodeSync(AccountRoutingPreviewInput)({
  projectId: "project-1",
  requestedSelection: { instanceId: UD, model: MODEL, options: OPTIONS },
});
const decodePreviewResult = Schema.decodeUnknownSync(AccountRoutingPreviewResult);

function verified<Value>(value: Value, observedAt = NOW): AccountRoutingEvidence<Value> {
  return { status: "verified", value, observedAt };
}

function window(
  id: string,
  usedPercent = 10,
  patch: Partial<Extract<AccountRoutingWindow, { status: "verified" }>> = {},
): AccountRoutingWindow {
  return {
    id,
    role: "included",
    status: "verified",
    observedAt: NOW,
    usedPercent,
    resetsAt: NOW + 3_600_000,
    ...patch,
  };
}

function candidate(
  instanceId: ProviderInstanceId,
  patch: Partial<AccountRoutingCandidate> = {},
): AccountRoutingCandidate {
  return {
    instanceId,
    enabled: true,
    projectEnabled: true,
    authenticated: true,
    executionAllowed: true,
    privateRoute: true,
    models: [
      {
        slug: MODEL,
        capabilities: {
          optionDescriptors: [
            {
              id: "reasoningEffort",
              label: "Effort",
              type: "select",
              options: [
                { id: "max", label: "Max" },
                { id: "low", label: "Low" },
              ],
            },
            {
              id: "serviceTier",
              label: "Tier",
              type: "select",
              options: [{ id: "priority", label: "Priority" }],
            },
            { id: "fastMode", label: "Fast", type: "boolean" },
          ],
        },
      },
    ],
    identity: verified(`opaque-${instanceId}`),
    localBusy: verified(false),
    entitlement: verified("included"),
    modelScope: verified({ kind: "allModels" }),
    includedWindowIds: verified(["session", "weekly"]),
    includedOnlyProtection: verified(true),
    creditAuthorization: verified(true),
    creditBalance: verified(20),
    creditCapWindowIds: verified(["individual-monthly"]),
    windows: [
      window("session"),
      window("weekly"),
      window("individual-monthly", 30, { role: "creditCap" }),
    ],
    ...patch,
  };
}

function depleted(instanceId: ProviderInstanceId, patch: Partial<AccountRoutingCandidate> = {}) {
  return candidate(instanceId, {
    windows: [
      window("session", 95),
      window("weekly", 99),
      window("individual-monthly", 10, { role: "creditCap" }),
    ],
    ...patch,
  });
}

function select(
  candidates: ReadonlyArray<AccountRoutingCandidate>,
  patch: Partial<AccountRoutingSelectorInput> = {},
  now = NOW,
) {
  return selectAccountRouting({ policy: POLICY, request: REQUEST, candidates, ...patch }, now);
}

function stage(result: AccountRoutingPreviewResult, id: string) {
  const found = result.stages.find((entry) => entry.id === id);
  expect(found).toBeDefined();
  return found!;
}

describe("account routing order and exact targets", () => {
  it("selects the first eligible included stage and leaves every later stage unreachable", () => {
    const result = select([candidate(UD), candidate(LAB)]);
    expect(result.status).toBe("selected");
    expect(result.selectedStageId).toBe("lab-included");
    expect(result.target).toEqual({ ...REQUEST.requestedSelection, instanceId: LAB });
    expect(
      result.stages.slice(1).every((entry) => entry.reasons.includes("higherPrioritySelected")),
    ).toBe(true);
    expect(decodePreviewResult(result)).toEqual(result);
  });

  it("preserves complete options, their order, false values, and explicit empty options", () => {
    const result = select([candidate(LAB), candidate(UD)]);
    expect(result.target?.options).toEqual(OPTIONS);
    expect(result.requestedSelection).toEqual(REQUEST.requestedSelection);
    for (const options of [undefined, []]) {
      const requestedSelection =
        options === undefined
          ? { instanceId: UD, model: MODEL }
          : { instanceId: UD, model: MODEL, options };
      const preview = select([candidate(LAB)], { request: { ...REQUEST, requestedSelection } });
      expect(preview.target).toEqual({ ...requestedSelection, instanceId: LAB });
      expect(Object.hasOwn(preview.target!, "options")).toBe(options !== undefined);
    }
  });

  it("uses configured stage order and lets a verified refill regain first priority", () => {
    expect(select([depleted(LAB), candidate(UD)]).selectedStageId).toBe("ud-included");
    expect(select([candidate(LAB), candidate(UD)]).selectedStageId).toBe("lab-included");
    const reversed = {
      ...POLICY,
      revision: 2,
      stages: [POLICY.stages[1]!, POLICY.stages[0]!, ...POLICY.stages.slice(2)],
    };
    expect(select([candidate(LAB), candidate(UD)], { policy: reversed }).selectedStageId).toBe(
      "ud-included",
    );
  });

  it.each([
    { models: [{ slug: "gpt-6-luna", capabilities: null }] },
    { models: [{ slug: "GPT-6.1-SOL", capabilities: null }] },
    { models: [{ slug: MODEL, capabilities: null }] },
    {
      models: [
        {
          slug: MODEL,
          capabilities: {
            optionDescriptors: [
              {
                id: "reasoningEffort",
                label: "Effort",
                type: "select" as const,
                options: [{ id: "high", label: "High" }],
              },
            ],
          },
        },
      ],
    },
  ])("falls through incompatible exact model/options without substitutions: %j", (patch) => {
    const result = select([candidate(LAB, patch), candidate(UD)]);
    expect(result.selectedStageId).toBe("ud-included");
    expect(result.target).toEqual(REQUEST.requestedSelection);
    expect(stage(result, "lab-included").reasons).toEqual([
      patch.models[0]!.slug === MODEL ? "optionsUnsupported" : "modelUnsupported",
    ]);
  });

  it("an account pin overrides order while preserving the requested model/options", () => {
    const result = select([candidate(LAB), candidate(UD)], {
      request: { ...REQUEST, pinnedInstanceId: UD },
    });
    expect(result.selectedStageId).toBe("ud-included");
    expect(stage(result, "lab-included").reasons).toEqual(["pinMismatch"]);
    const exhaustedPin = select([candidate(LAB), depleted(UD)], {
      request: { ...REQUEST, pinnedInstanceId: UD },
    });
    expect(exhaustedPin.selectedStageId).toBe("ud-credits");
  });

  it("keeps unavailable and incompatible pins on their requested account", () => {
    const missing = select([candidate(LAB)], {
      request: { ...REQUEST, pinnedInstanceId: ProviderInstanceId.make("other") },
    });
    expect(missing.status).toBe("blocked");
    expect(missing.target).toBeNull();
    expect(missing.reasons).toEqual(["pinUnavailable"]);
    const unsupported = select([candidate(LAB), candidate(UD, { models: [] })], {
      request: { ...REQUEST, pinnedInstanceId: UD },
    });
    expect(unsupported.target).toBeNull();
    expect(stage(unsupported, "ud-included").reasons).toEqual(["modelUnsupported"]);
  });
});

describe("included evidence semantics", () => {
  it.each(["session", "weekly"])(
    "requires headroom strictly above the floor in the %s window",
    (id) => {
      const result = select([
        candidate(LAB, {
          windows: [
            window("session", id === "session" ? 95 : 0),
            window("weekly", id === "weekly" ? 95 : 0),
          ],
        }),
        candidate(UD),
      ]);
      expect(result.selectedStageId).toBe("ud-included");
      expect(stage(result, "lab-included").reasons).toContain("includedHeadroomLow");
      expect(
        select([candidate(LAB, { windows: [window("session", 94.9), window("weekly", 94.9)] })])
          .selectedStageId,
      ).toBe("lab-included");
    },
  );

  it("distinguishes missing and unknown applicability from an explicitly inapplicable session window", () => {
    for (const windows of [
      [window("weekly")],
      [window("weekly"), { id: "session", role: "included", status: "unknown" } as const],
    ]) {
      const result = select([candidate(LAB, { windows }), candidate(UD)]);
      expect(result.selectedStageId).toBe("ud-included");
      expect(stage(result, "lab-included").status).toBe("unknown");
    }
    const explicit = candidate(LAB, {
      windows: [
        window("weekly"),
        { id: "session", role: "included", status: "inapplicable", observedAt: NOW },
      ],
    });
    expect(select([explicit]).selectedStageId).toBe("lab-included");
  });

  it("accepts a verified complete weekly-only manifest while unknown applicability blocks it", () => {
    const weekly = candidate(LAB, {
      includedWindowIds: verified(["weekly"]),
      windows: [window("weekly")],
    });
    expect(select([weekly]).selectedStageId).toBe("lab-included");
    const unknown = select([{ ...weekly, includedWindowIds: UNKNOWN }, candidate(UD)]);
    expect(stage(unknown, "lab-included").reasons).toContain("windowApplicabilityUnknown");
  });

  it("keeps an individual monthly credit cap separate from included allowance", () => {
    const capOnly = candidate(LAB, {
      windows: [window("individual-monthly", 0, { role: "creditCap" })],
    });
    const result = select([capOnly, depleted(UD)]);
    expect(result.target).toBeNull();
    expect(stage(result, "lab-included").reasons).toContain("windowEvidenceMissing");
    expect(stage(result, "lab-credits").reasons).toEqual(["includedStagesUnconfirmed"]);
    expect(
      select([
        candidate(LAB, {
          windows: [
            window("session"),
            window("weekly"),
            window("individual-monthly", 100, { role: "creditCap" }),
          ],
        }),
      ]).selectedStageId,
    ).toBe("lab-included");
  });

  it("keeps a retained weekly row stale when other evidence has a fresh observation", () => {
    const partialSnapshot = {
      ...candidate(LAB, {
        windows: [
          window("session"),
          window("weekly", 0, { observedAt: NOW - 301_000 }),
          window("individual-monthly", 0, { role: "creditCap" }),
        ],
        creditBalance: verified(100),
      }),
      checkedAt: NOW,
    };
    const result = select([partialSnapshot, depleted(UD)]);
    expect(result.target).toBeNull();
    expect(stage(result, "lab-included").reasons).toContain("evidenceStale");
    expect(stage(result, "lab-credits").reasons).toEqual(["includedStagesUnconfirmed"]);
    expect(result.nextRefreshAt).toBe(DateTime.formatIso(DateTime.makeUnsafe(NOW)));
  });

  it("requires refresh after a reset passes and uses a new observation to restore eligibility", () => {
    const reset = NOW - 1_000;
    const old = candidate(LAB, {
      windows: [
        window("session", 100, { observedAt: NOW - 2_000, resetsAt: reset }),
        window("weekly"),
      ],
    });
    const result = select([old, depleted(UD)]);
    expect(result.status).toBe("waiting");
    expect(result.target).toBeNull();
    expect(stage(result, "lab-included").reasons).toContain("resetRefreshRequired");
    expect(select([candidate(LAB), depleted(UD)]).selectedStageId).toBe("lab-included");
  });

  it("keeps an elapsed reset blocked even when a partial update reports fresh zero usage", () => {
    const result = select([
      candidate(LAB, { windows: [window("session", 0, { resetsAt: NOW - 1 }), window("weekly")] }),
      depleted(UD),
    ]);
    expect(result.target).toBeNull();
    expect(stage(result, "lab-included").reasons).toContain("resetRefreshRequired");
    expect(stage(result, "lab-credits").reasons).toEqual(["includedStagesUnconfirmed"]);
  });

  it("requires explicit model coverage for shared windows", () => {
    expect(
      select([candidate(LAB, { modelScope: verified({ kind: "models", models: [MODEL] }) })])
        .selectedStageId,
    ).toBe("lab-included");
    const uncovered = select([
      depleted(LAB, { modelScope: verified({ kind: "models", models: ["gpt-6-luna"] }) }),
      depleted(UD),
    ]);
    expect(uncovered.target).toBeNull();
    expect(stage(uncovered, "lab-included").reasons).toContain("modelScopeMismatch");
  });

  it.each([
    { entitlement: UNKNOWN },
    { modelScope: UNKNOWN },
    { modelScope: verified({ kind: "models" as const, models: ["gpt-6-luna"] }) },
    { includedOnlyProtection: UNKNOWN },
    { includedOnlyProtection: verified(false) },
    { identity: UNKNOWN },
  ])(
    "allows verified later included allowance while uncertain earlier evidence blocks credits: %j",
    (patch) => {
      expect(select([candidate(LAB, patch), candidate(UD)]).selectedStageId).toBe("ud-included");
      const exhausted = select([candidate(LAB, patch), depleted(UD)]);
      expect(exhausted.target).toBeNull();
      expect(stage(exhausted, "lab-credits").reasons).toEqual(["includedStagesUnconfirmed"]);
    },
  );

  it("blocks unsupported real-provider evidence with safe actionable reason codes", () => {
    const result = select([
      candidate(LAB, { includedOnlyProtection: UNKNOWN }),
      candidate(UD, { includedOnlyProtection: UNKNOWN }),
    ]);
    expect(result.status).toBe("blocked");
    expect(result.dispatchAllowed).toBe(false);
    expect(stage(result, "lab-included").reasons).toEqual(["includedProtectionUnknown"]);
  });
});

describe("credits admission", () => {
  it("uses first-priority credits only after every included stage is confirmed at the guard", () => {
    const result = select([depleted(LAB), depleted(UD)]);
    expect(result.selectedStageId).toBe("lab-credits");
    expect(result.target).toEqual({ ...REQUEST.requestedSelection, instanceId: LAB });
  });

  it("keeps unknown included protection blocking credits even with verified low headroom", () => {
    const result = select([depleted(LAB, { includedOnlyProtection: UNKNOWN }), depleted(UD)]);
    expect(result.target).toBeNull();
    expect(stage(result, "lab-included").reasons).toContain("includedProtectionUnknown");
    expect(stage(result, "lab-credits").reasons).toEqual(["includedStagesUnconfirmed"]);
  });

  it("accepts verified credits-only entitlement and explicitly inapplicable included windows", () => {
    const result = select([
      candidate(LAB, {
        entitlement: verified("creditsOnly"),
        includedWindowIds: UNKNOWN,
        includedOnlyProtection: UNKNOWN,
      }),
      candidate(UD, { includedWindowIds: verified([]), includedOnlyProtection: UNKNOWN }),
    ]);
    expect(result.selectedStageId).toBe("lab-credits");
    expect(stage(result, "lab-included").reasons).toEqual(["noIncludedEntitlement"]);
    expect(stage(result, "ud-included").reasons).toEqual(["noIncludedEntitlement"]);
  });

  it("moves to later credits after confirmed balance depletion or a reached credit cap", () => {
    for (const lab of [
      depleted(LAB, { creditBalance: verified(0) }),
      depleted(LAB, {
        windows: [
          window("session", 100),
          window("weekly", 100),
          window("individual-monthly", 100, { role: "creditCap" }),
        ],
      }),
    ]) {
      expect(select([lab, depleted(UD)]).selectedStageId).toBe("ud-credits");
    }
  });

  it.each([
    { creditAuthorization: UNKNOWN },
    { creditBalance: UNKNOWN },
    { creditCapWindowIds: UNKNOWN },
    { creditBalance: verified(100, NOW - 301_000) },
    {
      windows: [
        window("session", 100),
        window("weekly", 100),
        window("individual-monthly", 0, { role: "creditCap", observedAt: NOW - 301_000 }),
      ],
    },
  ])("blocks lower-priority credits when the earlier credit stage is unknown: %j", (patch) => {
    const result = select([depleted(LAB, patch), depleted(UD)]);
    expect(result.target).toBeNull();
    expect(stage(result, "lab-credits").status).toBe("unknown");
    expect(stage(result, "ud-credits").reasons).toEqual(["creditPriorityUnconfirmed"]);
  });

  it("requires authorization in addition to a positive balance", () => {
    const result = select([
      depleted(LAB, { creditAuthorization: UNKNOWN, creditBalance: verified(1_000) }),
      depleted(UD),
    ]);
    expect(result.target).toBeNull();
    expect(stage(result, "lab-credits").reasons).toContain("creditAuthorizationUnknown");
    expect(
      select([depleted(LAB, { creditAuthorization: verified(false) }), depleted(UD)])
        .selectedStageId,
    ).toBe("ud-credits");
  });

  it("requires a verified cap manifest, including an explicitly verified absence of caps", () => {
    expect(
      select([depleted(LAB, { creditCapWindowIds: verified([]) }), depleted(UD)]).selectedStageId,
    ).toBe("lab-credits");
    const missingCap = select([
      depleted(LAB, { creditCapWindowIds: verified(["missing-cap"]) }),
      depleted(UD),
    ]);
    expect(missingCap.target).toBeNull();
    expect(stage(missingCap, "lab-credits").reasons).toContain("windowEvidenceMissing");
  });
});

describe("constraints, aliases, and preview boundaries", () => {
  it.each([
    [{ enabled: false }, "instanceDisabled"],
    [{ projectEnabled: false }, "projectDisabled"],
    [{ authenticated: false }, "authenticationRequired"],
    [{ executionAllowed: false }, "executionDenied"],
    [{ privateRoute: false }, "privateRouteRequired"],
  ] as const)("filters hard constraints before funding: %j", (patch, reason) => {
    const result = select([candidate(LAB, patch), candidate(UD)], {
      request: { ...REQUEST, requirePrivateRoute: true },
    });
    expect(result.selectedStageId).toBe("ud-included");
    expect(stage(result, "lab-included").reasons).toEqual([reason]);
  });

  it("deduplicates verified account aliases without treating an alias as a fresh allowance", () => {
    const sharedIdentity = verified("same-real-account");
    const result = select([
      candidate(LAB, { identity: sharedIdentity, includedOnlyProtection: UNKNOWN }),
      candidate(UD, { identity: sharedIdentity }),
    ]);
    expect(result.target).toBeNull();
    expect(stage(result, "ud-included").reasons).toEqual(["duplicateIdentity"]);
    const spent = select([
      depleted(LAB, { identity: sharedIdentity, creditBalance: verified(0) }),
      depleted(UD, { identity: sharedIdentity }),
    ]);
    expect(spent.target).toBeNull();
    expect(stage(spent, "ud-credits").reasons).toEqual(["duplicateIdentity"]);
  });

  it("shares busy evidence across aliases and keeps old unresolved busy evidence blocking", () => {
    const sharedIdentity = verified("same-real-account");
    const result = select([
      candidate(LAB, { identity: sharedIdentity }),
      candidate(UD, { identity: sharedIdentity, localBusy: verified(true, NOW - 301_000) }),
    ]);
    expect(result.status).toBe("waiting");
    expect(result.target).toBeNull();
    expect(stage(result, "lab-included").reasons).toContain("accountBusy");
    expect(select([candidate(LAB, { localBusy: UNKNOWN }), candidate(UD)]).selectedStageId).toBe(
      "ud-included",
    );
  });

  it("reports missing or ambiguous registered candidates without authorizing credit escalation", () => {
    const missing = select([depleted(UD)]);
    expect(missing.target).toBeNull();
    expect(stage(missing, "lab-included").reasons).toEqual(["candidateMissing"]);
    const ambiguous = select([candidate(LAB), candidate(LAB), depleted(UD)]);
    expect(stage(ambiguous, "lab-included").reasons).toEqual(["candidateAmbiguous"]);
    expect(ambiguous.target).toBeNull();
  });

  it("keeps off, observe, enforce, and absent policies incapable of enabling dispatch", () => {
    for (const mode of ["off", "observe", "enforce"] as const) {
      const result = select([candidate(LAB), candidate(UD)], { policy: { ...POLICY, mode } });
      expect(result.dispatchAllowed).toBe(false);
      expect(result.activationBlockers).toContain("previewOnly");
      expect(result.status).toBe(mode === "off" ? "blocked" : "selected");
      if (mode === "off") expect(result.target).toBeNull();
    }
    const absent = select([candidate(LAB)], { policy: null });
    expect(absent.status).toBe("blocked");
    expect(absent.policySnapshot).toBeNull();
    expect(absent.reasons).toEqual(["policyMissing"]);
  });

  it("returns identical immutable snapshots and excludes private evidence from results", () => {
    const privateKey = "secret-identity@example.test:/home/private:workspace-sensitive";
    const candidates = [candidate(LAB, { identity: verified(privateKey) }), candidate(UD)];
    const policy = { ...POLICY, stages: POLICY.stages.map((entry) => ({ ...entry })) };
    const input = { policy, request: REQUEST, candidates };
    const first = selectAccountRouting(input, NOW);
    expect(selectAccountRouting(input, NOW)).toEqual(first);
    expect(JSON.stringify(first)).not.toContain(privateKey);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.policySnapshot)).toBe(true);
    expect(Object.isFrozen(first.policySnapshot?.stages)).toBe(true);
    expect(Object.isFrozen(first.policySnapshot?.stages[0])).toBe(true);
    expect(Object.isFrozen(first.target?.options?.[0])).toBe(true);
    policy.stages[0]!.id = "changed-after-preview";
    expect(first.policySnapshot?.stages[0]?.id).toBe("lab-included");
    expect(first.target).not.toBe(REQUEST.requestedSelection);
  });

  it.each([
    { windows: [window("session", Number.NaN), window("weekly")] },
    { windows: [window("session", -1), window("weekly")] },
    { windows: [window("session", 101), window("weekly")] },
    { windows: [window("session", 0, { observedAt: NOW + 1 }), window("weekly")] },
    { entitlement: verified("included" as const, Number.NaN) },
  ])("fails closed for invalid or future normalized evidence: %j", (patch) => {
    const result = select([candidate(LAB, patch), depleted(UD)]);
    expect(result.target).toBeNull();
    expect(stage(result, "lab-included").status).toBe("unknown");
  });

  it("uses the supplied clock and refresh schedule without consulting wall-clock state", () => {
    const candidates = [candidate(LAB), candidate(UD)];
    const fresh = select(candidates);
    expect(fresh.nextRefreshAt).toBe(DateTime.formatIso(DateTime.makeUnsafe(NOW + 300_000)));
    const stale = select(candidates, {}, NOW + 301_000);
    expect(stale.status).toBe("waiting");
    expect(stale.target).toBeNull();
    expect(() => select(candidates, {}, Number.NaN)).toThrow(RangeError);
  });
});
