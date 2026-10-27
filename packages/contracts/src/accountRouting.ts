import * as Schema from "effect/Schema";

import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const ACCOUNT_ROUTING_MAX_STAGES = 16;

const StableId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
);

export const AccountRoutingMode = Schema.Literals(["off", "observe", "enforce"]);
export type AccountRoutingMode = typeof AccountRoutingMode.Type;

export const AccountRoutingFundingIntent = Schema.Literals(["includedOnly", "creditsAllowed"]);
export type AccountRoutingFundingIntent = typeof AccountRoutingFundingIntent.Type;

export const AccountRoutingStage = Schema.Struct({
  id: StableId,
  instanceId: ProviderInstanceId,
  fundingIntent: AccountRoutingFundingIntent,
});
export type AccountRoutingStage = typeof AccountRoutingStage.Type;

export const AccountRoutingPolicy = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  policyId: StableId,
  revision: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
  mode: AccountRoutingMode,
  modelMatch: Schema.Literal("exact"),
  stages: Schema.Array(AccountRoutingStage).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(ACCOUNT_ROUTING_MAX_STAGES),
    Schema.makeFilter((stages) => new Set(stages.map((stage) => stage.id)).size === stages.length, {
      expected: "unique stable stage IDs",
    }),
    Schema.makeFilter(
      (stages) => {
        const firstCredit = stages.findIndex((stage) => stage.fundingIntent === "creditsAllowed");
        return (
          stages[0]?.fundingIntent === "includedOnly" &&
          (firstCredit === -1 ||
            stages.slice(firstCredit).every((stage) => stage.fundingIntent === "creditsAllowed"))
        );
      },
      { expected: "an included-stage prefix followed by credit stages" },
    ),
  ),
  maxEvidenceAgeSeconds: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 86_400 })),
  minimumHeadroomPercent: Schema.Number.check(
    Schema.isFinite(),
    Schema.isBetween({ minimum: 0, maximum: 100 }),
  ),
  paidApiFallback: Schema.Literal(false),
});
export type AccountRoutingPolicy = typeof AccountRoutingPolicy.Type;

const ExactSelection = ModelSelection.check(
  Schema.makeFilter(
    (selection) =>
      selection.model.length <= 256 &&
      (selection.options?.length ?? 0) <= 32 &&
      new Set(selection.options?.map((option) => option.id)).size ===
        (selection.options?.length ?? 0) &&
      (selection.options ?? []).every(
        (option) =>
          option.id.length <= 64 &&
          (typeof option.value === "boolean" || option.value.length <= 256),
      ),
    { expected: "a bounded model selection with unique option IDs" },
  ),
);

/** Account evidence comes exclusively from the server's normalized adapter inputs. */
export const AccountRoutingPreviewInput = Schema.Struct({
  projectId: ProjectId.check(Schema.isMaxLength(128)),
  threadId: Schema.optionalKey(ThreadId.check(Schema.isMaxLength(128))),
  requestedSelection: ExactSelection,
  pinnedInstanceId: Schema.optionalKey(ProviderInstanceId),
  requirePrivateRoute: Schema.optionalKey(Schema.Boolean),
});
export type AccountRoutingPreviewInput = typeof AccountRoutingPreviewInput.Type;

export const AccountRoutingReason = Schema.Literals([
  "selected",
  "policyMissing",
  "policyOff",
  "pinMismatch",
  "pinUnavailable",
  "candidateMissing",
  "candidateAmbiguous",
  "instanceDisabled",
  "projectDisabled",
  "authenticationRequired",
  "executionDenied",
  "privateRouteRequired",
  "modelUnsupported",
  "optionsUnsupported",
  "identityUnknown",
  "duplicateIdentity",
  "accountBusy",
  "busyEvidenceUnknown",
  "entitlementUnknown",
  "noIncludedEntitlement",
  "modelScopeUnknown",
  "modelScopeMismatch",
  "windowApplicabilityUnknown",
  "windowEvidenceMissing",
  "evidenceStale",
  "evidenceInvalid",
  "evidenceFuture",
  "resetRefreshRequired",
  "includedHeadroomLow",
  "includedProtectionUnknown",
  "includedProtectionUnavailable",
  "creditAuthorizationUnknown",
  "creditsUnauthorized",
  "noCreditEntitlement",
  "creditBalanceUnknown",
  "creditBalanceInsufficient",
  "creditCapsUnknown",
  "creditCapExhausted",
  "includedStagesUnconfirmed",
  "creditPriorityUnconfirmed",
  "higherPrioritySelected",
  "noEligibleStage",
]);
export type AccountRoutingReason = typeof AccountRoutingReason.Type;

const Reasons = Schema.Array(AccountRoutingReason).check(Schema.isMaxLength(32));
const Timestamp = Schema.String.check(
  Schema.isMaxLength(32),
  Schema.makeFilter((value) => Number.isFinite(Date.parse(value)), {
    expected: "an ISO timestamp",
  }),
);

export const AccountRoutingStagePreview = Schema.Struct({
  ...AccountRoutingStage.fields,
  status: Schema.Literals(["eligible", "ineligible", "unknown", "skipped"]),
  reasons: Reasons,
  nextRefreshAt: Schema.NullOr(Timestamp),
});
export type AccountRoutingStagePreview = typeof AccountRoutingStagePreview.Type;

export const AccountRoutingActivationBlocker = Schema.Literals([
  "previewOnly",
  "policyMissing",
  "policyOff",
  "observeMode",
]);
export type AccountRoutingActivationBlocker = typeof AccountRoutingActivationBlocker.Type;

export const AccountRoutingPreviewResult = Schema.Struct({
  status: Schema.Literals(["selected", "waiting", "blocked"]),
  evaluatedAt: Timestamp,
  mode: Schema.NullOr(AccountRoutingMode),
  requestedSelection: ExactSelection,
  target: Schema.NullOr(ExactSelection),
  selectedStageId: Schema.NullOr(StableId),
  reasons: Reasons,
  stages: Schema.Array(AccountRoutingStagePreview).check(
    Schema.isMaxLength(ACCOUNT_ROUTING_MAX_STAGES),
  ),
  nextRefreshAt: Schema.NullOr(Timestamp),
  dispatchAllowed: Schema.Literal(false),
  activationBlockers: Schema.Array(AccountRoutingActivationBlocker).check(Schema.isMaxLength(4)),
  policySnapshot: Schema.NullOr(AccountRoutingPolicy),
});
export type AccountRoutingPreviewResult = typeof AccountRoutingPreviewResult.Type;
