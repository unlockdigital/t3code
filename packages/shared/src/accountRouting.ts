import type {
  AccountRoutingActivationBlocker,
  AccountRoutingPolicy,
  AccountRoutingPreviewInput,
  AccountRoutingPreviewResult,
  AccountRoutingReason,
  AccountRoutingStage,
  AccountRoutingStagePreview,
  ModelSelection,
  ServerProviderModel,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { getProviderOptionDescriptors } from "./model.ts";

/** Each item retains its provider observation time through partial snapshot merges. */
export type AccountRoutingEvidence<Value> =
  | { readonly status: "verified"; readonly value: Value; readonly observedAt: number }
  | { readonly status: "unknown" };

export type AccountRoutingModelScope =
  | { readonly kind: "allModels" }
  | { readonly kind: "models"; readonly models: ReadonlyArray<string> };

/** Roles come from adapter semantics: an individual monthly cap has role creditCap. */
export type AccountRoutingWindow = {
  readonly id: string;
  readonly role: "included" | "creditCap";
} & (
  | {
      readonly status: "verified";
      readonly observedAt: number;
      readonly usedPercent: number;
      readonly resetsAt?: number;
    }
  | { readonly status: "inapplicable"; readonly observedAt: number }
  | { readonly status: "unknown" }
);

/** Server-owned facts for the preview's project and the current authenticated route. */
export interface AccountRoutingCandidate {
  readonly instanceId: ProviderInstanceId;
  readonly enabled: boolean;
  readonly projectEnabled: boolean;
  readonly authenticated: boolean;
  readonly executionAllowed: boolean;
  readonly privateRoute: boolean;
  readonly models: ReadonlyArray<Pick<ServerProviderModel, "slug" | "capabilities">>;
  /** Opaque verified account identity, shared by aliases; kept out of preview results. */
  readonly identity: AccountRoutingEvidence<string>;
  readonly localBusy: AccountRoutingEvidence<boolean>;
  readonly entitlement: AccountRoutingEvidence<"included" | "creditsOnly" | "none">;
  readonly modelScope: AccountRoutingEvidence<AccountRoutingModelScope>;
  /** A verified complete manifest; absent rows for listed IDs remain missing evidence. */
  readonly includedWindowIds: AccountRoutingEvidence<ReadonlyArray<string>>;
  readonly includedOnlyProtection: AccountRoutingEvidence<boolean>;
  readonly creditAuthorization: AccountRoutingEvidence<boolean>;
  readonly creditBalance: AccountRoutingEvidence<number>;
  /** A verified empty manifest explicitly establishes that no credit cap applies. */
  readonly creditCapWindowIds: AccountRoutingEvidence<ReadonlyArray<string>>;
  readonly windows: ReadonlyArray<AccountRoutingWindow>;
}

export interface AccountRoutingSelectorInput {
  readonly policy: AccountRoutingPolicy | null;
  readonly request: AccountRoutingPreviewInput;
  readonly candidates: ReadonlyArray<AccountRoutingCandidate>;
}

interface Inspection {
  readonly now: number;
  readonly maxAge: number;
  readonly reasons: Set<AccountRoutingReason>;
  nextRefreshAt: number | null;
  waiting: boolean;
}

interface Evaluation {
  readonly status: AccountRoutingStagePreview["status"];
  readonly reasons: ReadonlyArray<AccountRoutingReason>;
  readonly nextRefreshAt: number | null;
  readonly waiting: boolean;
  readonly includedConfirmedUnavailable: boolean;
}

const validTimestamp = (value: number) =>
  Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;

function refreshAt(inspection: Inspection, at: number) {
  inspection.nextRefreshAt = Math.min(inspection.nextRefreshAt ?? at, at);
}

function inspectTimestamp(observedAt: number, inspection: Inspection): boolean {
  if (!validTimestamp(observedAt)) {
    inspection.reasons.add("evidenceInvalid");
    return false;
  }
  if (observedAt > inspection.now) {
    inspection.reasons.add("evidenceFuture");
    refreshAt(inspection, inspection.now);
    inspection.waiting = true;
    return false;
  }
  const expiresAt = Math.min(observedAt + inspection.maxAge, 8_640_000_000_000_000);
  refreshAt(inspection, Math.max(inspection.now, expiresAt));
  if (inspection.now - observedAt > inspection.maxAge) {
    inspection.reasons.add("evidenceStale");
    inspection.waiting = true;
    return false;
  }
  return true;
}

function readEvidence<Value>(
  evidence: AccountRoutingEvidence<Value>,
  unknownReason: AccountRoutingReason,
  inspection: Inspection,
): Value | undefined {
  if (evidence.status === "unknown") {
    inspection.reasons.add(unknownReason);
    return undefined;
  }
  if (!inspectTimestamp(evidence.observedAt, inspection)) {
    inspection.reasons.add(unknownReason);
    return undefined;
  }
  return evidence.value;
}

function evaluation(
  inspection: Inspection,
  status: Evaluation["status"],
  reason?: AccountRoutingReason,
  includedConfirmedUnavailable = false,
): Evaluation {
  if (reason) inspection.reasons.add(reason);
  return {
    status,
    reasons: [...inspection.reasons],
    nextRefreshAt: inspection.nextRefreshAt,
    waiting: inspection.waiting,
    includedConfirmedUnavailable,
  };
}

function exactModelReasons(
  candidate: AccountRoutingCandidate,
  selection: ModelSelection,
): ReadonlyArray<AccountRoutingReason> {
  const models = candidate.models.filter((model) => model.slug === selection.model);
  const model = models[0];
  if (models.length !== 1 || !model) return ["modelUnsupported"];
  const selections = selection.options ?? [];
  const descriptors = getProviderOptionDescriptors({ caps: model.capabilities ?? {} });
  const seen = new Set<string>();
  for (const option of selections) {
    const matches = descriptors.filter((descriptor) => descriptor.id === option.id);
    const descriptor = matches[0];
    if (
      seen.has(option.id) ||
      matches.length !== 1 ||
      !descriptor ||
      (descriptor.type === "boolean"
        ? typeof option.value !== "boolean"
        : !descriptor.options.some((choice) => choice.id === option.value))
    ) {
      return ["optionsUnsupported"];
    }
    seen.add(option.id);
  }
  return [];
}

function inspectWindows(
  manifest: AccountRoutingEvidence<ReadonlyArray<string>>,
  candidate: AccountRoutingCandidate,
  role: AccountRoutingWindow["role"],
  floor: number,
  inspection: Inspection,
): { readonly applicable: number; readonly exhausted: boolean } | undefined {
  const ids = readEvidence(
    manifest,
    role === "included" ? "windowApplicabilityUnknown" : "creditCapsUnknown",
    inspection,
  );
  if (ids === undefined) return undefined;
  if (new Set(ids).size !== ids.length || ids.some((id) => id.length === 0)) {
    inspection.reasons.add("evidenceInvalid");
    return undefined;
  }
  let applicable = 0;
  let exhausted = false;
  let complete = true;
  for (const id of ids) {
    const matches = candidate.windows.filter((window) => window.id === id && window.role === role);
    const window = matches[0];
    if (matches.length !== 1 || !window) {
      inspection.reasons.add(matches.length === 0 ? "windowEvidenceMissing" : "evidenceInvalid");
      complete = false;
      continue;
    }
    if (window.status === "unknown") {
      inspection.reasons.add("windowApplicabilityUnknown");
      complete = false;
      continue;
    }
    if (!inspectTimestamp(window.observedAt, inspection)) {
      complete = false;
      continue;
    }
    if (window.status === "inapplicable") continue;
    applicable++;
    if (
      !Number.isFinite(window.usedPercent) ||
      window.usedPercent < 0 ||
      window.usedPercent > 100 ||
      (window.resetsAt !== undefined && !validTimestamp(window.resetsAt))
    ) {
      inspection.reasons.add("evidenceInvalid");
      complete = false;
      continue;
    }
    if (window.resetsAt !== undefined) {
      refreshAt(inspection, Math.max(inspection.now, window.resetsAt));
      if (window.resetsAt <= inspection.now) {
        inspection.reasons.add("resetRefreshRequired");
        inspection.waiting = true;
        complete = false;
        continue;
      }
    }
    if (100 - window.usedPercent <= floor) {
      exhausted = true;
      if (window.resetsAt !== undefined) inspection.waiting = true;
    }
  }
  return complete ? { applicable, exhausted } : undefined;
}

function evaluateFunding(
  candidate: AccountRoutingCandidate,
  stage: AccountRoutingStage,
  policy: AccountRoutingPolicy,
  inspection: Inspection,
): Evaluation {
  const entitlement = readEvidence(candidate.entitlement, "entitlementUnknown", inspection);
  if (entitlement === undefined) return evaluation(inspection, "unknown");
  if (stage.fundingIntent === "includedOnly") {
    if (entitlement !== "included") {
      return evaluation(inspection, "ineligible", "noIncludedEntitlement", true);
    }
    const windows = inspectWindows(
      candidate.includedWindowIds,
      candidate,
      "included",
      policy.minimumHeadroomPercent,
      inspection,
    );
    if (windows === undefined) return evaluation(inspection, "unknown");
    if (windows.applicable === 0) {
      return evaluation(inspection, "ineligible", "noIncludedEntitlement", true);
    }
    const protection = readEvidence(
      candidate.includedOnlyProtection,
      "includedProtectionUnknown",
      inspection,
    );
    if (protection === undefined) return evaluation(inspection, "unknown");
    if (!protection) return evaluation(inspection, "ineligible", "includedProtectionUnavailable");
    if (windows.exhausted) {
      return evaluation(inspection, "ineligible", "includedHeadroomLow", true);
    }
    return evaluation(inspection, "eligible", "selected");
  }
  if (entitlement === "none") return evaluation(inspection, "ineligible", "noCreditEntitlement");
  const authorized = readEvidence(
    candidate.creditAuthorization,
    "creditAuthorizationUnknown",
    inspection,
  );
  const balance = readEvidence(candidate.creditBalance, "creditBalanceUnknown", inspection);
  const caps = inspectWindows(candidate.creditCapWindowIds, candidate, "creditCap", 0, inspection);
  if (authorized === undefined || balance === undefined || caps === undefined) {
    return evaluation(inspection, "unknown");
  }
  if (!Number.isFinite(balance) || balance < 0) {
    return evaluation(inspection, "unknown", "evidenceInvalid");
  }
  if (!authorized) return evaluation(inspection, "ineligible", "creditsUnauthorized");
  if (balance === 0) return evaluation(inspection, "ineligible", "creditBalanceInsufficient");
  if (caps.exhausted) return evaluation(inspection, "ineligible", "creditCapExhausted");
  return evaluation(inspection, "eligible", "selected");
}

function evaluateCandidate(
  input: AccountRoutingSelectorInput,
  policy: AccountRoutingPolicy,
  stage: AccountRoutingStage,
  now: number,
  seenIdentities: Map<string, Evaluation>,
): Evaluation {
  const inspection: Inspection = {
    now,
    maxAge: policy.maxEvidenceAgeSeconds * 1_000,
    reasons: new Set(),
    nextRefreshAt: null,
    waiting: false,
  };
  const matches = input.candidates.filter((candidate) => candidate.instanceId === stage.instanceId);
  const candidate = matches[0];
  if (!candidate || matches.length !== 1) {
    return evaluation(inspection, "unknown", candidate ? "candidateAmbiguous" : "candidateMissing");
  }
  if (!candidate.enabled) inspection.reasons.add("instanceDisabled");
  if (!candidate.projectEnabled) inspection.reasons.add("projectDisabled");
  if (!candidate.authenticated) inspection.reasons.add("authenticationRequired");
  if (!candidate.executionAllowed) inspection.reasons.add("executionDenied");
  if (input.request.requirePrivateRoute && !candidate.privateRoute) {
    inspection.reasons.add("privateRouteRequired");
  }
  for (const reason of exactModelReasons(candidate, input.request.requestedSelection)) {
    inspection.reasons.add(reason);
  }
  if (inspection.reasons.size > 0) return evaluation(inspection, "ineligible");
  const identity = readEvidence(candidate.identity, "identityUnknown", inspection);
  if (identity === undefined) return evaluation(inspection, "unknown");
  if (identity.trim().length === 0) return evaluation(inspection, "unknown", "evidenceInvalid");
  const previous = seenIdentities.get(identity);
  if (previous) {
    return { ...previous, status: "skipped", reasons: ["duplicateIdentity"] };
  }

  // A known unresolved hold keeps every alias busy, including after its observation ages out.
  const aliases = input.candidates.filter(
    (alias) => alias.identity.status === "verified" && alias.identity.value === identity,
  );
  let busy = false;
  let busyUnknown = false;
  for (const alias of aliases) {
    if (alias.localBusy.status === "verified" && alias.localBusy.value) busy = true;
    if (readEvidence(alias.localBusy, "busyEvidenceUnknown", inspection) === undefined) {
      busyUnknown = true;
    }
  }
  let result: Evaluation;
  if (busy) {
    inspection.waiting = true;
    result = evaluation(inspection, "ineligible", "accountBusy");
  } else if (busyUnknown) {
    result = evaluation(inspection, "unknown");
  } else {
    const scope = readEvidence(candidate.modelScope, "modelScopeUnknown", inspection);
    if (scope === undefined) {
      result = evaluation(inspection, "unknown");
    } else if (
      scope.kind === "models" &&
      !scope.models.includes(input.request.requestedSelection.model)
    ) {
      result = evaluation(inspection, "unknown", "modelScopeMismatch");
    } else {
      result = evaluateFunding(candidate, stage, policy, inspection);
    }
  }
  seenIdentities.set(identity, result);
  return result;
}

function copySelection(
  selection: ModelSelection,
  instanceId = selection.instanceId,
): ModelSelection {
  return Object.freeze({
    instanceId,
    model: selection.model,
    ...(selection.options === undefined
      ? {}
      : {
          options: Object.freeze(
            selection.options.map((option) =>
              Object.freeze({ id: option.id, value: option.value }),
            ),
          ),
        }),
  });
}

function copyPolicy(policy: AccountRoutingPolicy): AccountRoutingPolicy {
  return Object.freeze({
    schemaVersion: policy.schemaVersion,
    policyId: policy.policyId,
    revision: policy.revision,
    mode: policy.mode,
    modelMatch: policy.modelMatch,
    stages: Object.freeze(
      policy.stages.map((stage) =>
        Object.freeze({
          id: stage.id,
          instanceId: stage.instanceId,
          fundingIntent: stage.fundingIntent,
        }),
      ),
    ),
    maxEvidenceAgeSeconds: policy.maxEvidenceAgeSeconds,
    minimumHeadroomPercent: policy.minimumHeadroomPercent,
    paidApiFallback: policy.paidApiFallback,
  });
}

function skipped(reason: AccountRoutingReason): Evaluation {
  return {
    status: "skipped",
    reasons: [reason],
    nextRefreshAt: null,
    waiting: false,
    includedConfirmedUnavailable: false,
  };
}

export function selectAccountRouting(
  input: AccountRoutingSelectorInput,
  now: number,
): AccountRoutingPreviewResult {
  if (!validTimestamp(now))
    throw new RangeError("Account routing requires a valid UTC epoch time.");
  const { policy, request } = input;
  const stages: AccountRoutingStagePreview[] = [];
  const activationBlockers: AccountRoutingActivationBlocker[] = ["previewOnly"];
  const includedIdentities = new Map<string, Evaluation>();
  const creditIdentities = new Map<string, Evaluation>();
  let includedConfirmedUnavailable = true;
  let creditPriorityUnknown = false;
  let target: ModelSelection | null = null;
  let selectedStageId: string | null = null;
  let waiting = false;
  let nextRefreshAt: number | null = null;

  if (!policy) activationBlockers.push("policyMissing");
  else if (policy.mode === "off") activationBlockers.push("policyOff");
  else if (policy.mode === "observe") activationBlockers.push("observeMode");

  if (policy) {
    for (const stage of policy.stages) {
      let result: Evaluation;
      if (policy.mode === "off") result = skipped("policyOff");
      else if (request.pinnedInstanceId && stage.instanceId !== request.pinnedInstanceId) {
        result = skipped("pinMismatch");
      } else if (target) result = skipped("higherPrioritySelected");
      else if (stage.fundingIntent === "creditsAllowed" && !includedConfirmedUnavailable) {
        result = skipped("includedStagesUnconfirmed");
      } else if (stage.fundingIntent === "creditsAllowed" && creditPriorityUnknown) {
        result = skipped("creditPriorityUnconfirmed");
      } else {
        result = evaluateCandidate(
          input,
          policy,
          stage,
          now,
          stage.fundingIntent === "includedOnly" ? includedIdentities : creditIdentities,
        );
        if (stage.fundingIntent === "includedOnly") {
          includedConfirmedUnavailable &&= result.includedConfirmedUnavailable;
        } else if (result.status === "unknown") creditPriorityUnknown = true;
        if (result.status === "eligible") {
          target = copySelection(request.requestedSelection, stage.instanceId);
          selectedStageId = stage.id;
        }
      }
      waiting ||= result.waiting;
      if (result.nextRefreshAt !== null) {
        nextRefreshAt = Math.min(nextRefreshAt ?? result.nextRefreshAt, result.nextRefreshAt);
      }
      stages.push(
        Object.freeze({
          id: stage.id,
          instanceId: stage.instanceId,
          fundingIntent: stage.fundingIntent,
          status: result.status,
          reasons: Object.freeze([...result.reasons]),
          nextRefreshAt:
            result.nextRefreshAt === null
              ? null
              : DateTime.formatIso(DateTime.makeUnsafe(result.nextRefreshAt)),
        }),
      );
    }
  }

  const reasons: AccountRoutingReason[] = [];
  if (!policy) reasons.push("policyMissing");
  else if (policy.mode === "off") reasons.push("policyOff");
  else if (
    request.pinnedInstanceId &&
    !policy.stages.some((stage) => stage.instanceId === request.pinnedInstanceId)
  ) {
    reasons.push("pinUnavailable");
  } else reasons.push(target ? "selected" : "noEligibleStage");
  return Object.freeze({
    status: target ? "selected" : waiting ? "waiting" : "blocked",
    evaluatedAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
    mode: policy?.mode ?? null,
    requestedSelection: copySelection(request.requestedSelection),
    target,
    selectedStageId,
    reasons: Object.freeze(reasons),
    stages: Object.freeze(stages),
    nextRefreshAt:
      nextRefreshAt === null ? null : DateTime.formatIso(DateTime.makeUnsafe(nextRefreshAt)),
    dispatchAllowed: false,
    activationBlockers: Object.freeze(activationBlockers),
    policySnapshot: policy === null ? null : copyPolicy(policy),
  });
}
