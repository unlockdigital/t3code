import * as Schema from "effect/Schema";
import { EnvironmentId, ThreadId, IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export class N2itionConnectionError extends Schema.TaggedError<N2itionConnectionError>()(
  "N2itionConnectionError",
  {
    reason: Schema.Literals([
      "disabled",
      "paused",
      "revoked",
      "expired",
      "unauthorized",
      "route_changed",
      "privacy_required",
      "unavailable",
      "too_large",
      "invalid_data",
      "rate_limited",
      "changed",
    ]),
  },
) {
  override get message() {
    if (this.reason === "route_changed")
      return "N2ITION context is paused because its approved inference route or source credential changed. Re-enroll this environment's live connection after verifying the route.";
    return `N2ITION context: ${this.reason}.`;
  }
}
export const N2itionGrant = Schema.Struct({
  version: Schema.Literal(1),
  environmentId: EnvironmentId,
  threadId: ThreadId,
  providerInstanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  source: Schema.Literals(["synthetic", "live"]),
  origin: Schema.String,
  mode: Schema.Literals(["active", "paused", "revoked"]),
  epoch: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  expiresAt: IsoDateTime,
  cadenceHours: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 6 })),
  privacyVerified: Schema.Boolean,
  sharedProcessAccepted: Schema.Boolean,
  // Optional decoding preserves owner controls for legacy grants; live reads require this binding.
  routeBinding: Schema.optionalKey(
    Schema.Struct({
      providerConfigHash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
      accountRouteHash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
    }),
  ),
  // Credential rotation requires explicit re-enrollment; optional decoding retains legacy controls.
  sourceCredentialHash: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))),
  // Metadata detects ordinary account/config changes; it provides no account attestation.
  routeFiles: Schema.Array(
    Schema.Struct({ path: Schema.String, fingerprint: Schema.String }),
  ).check(Schema.isMaxLength(8)),
});
export type N2itionGrant = typeof N2itionGrant.Type;
export const N2itionControlInput = Schema.Struct({
  action: Schema.Literals(["pause", "resume", "revoke"]),
  expectedEpoch: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type N2itionControlInput = typeof N2itionControlInput.Type;
export class N2itionStatus extends Schema.Class<N2itionStatus>("N2itionStatus")({
  localMode: Schema.NullOr(Schema.Literals(["active", "paused", "revoked"])),
  state: Schema.String,
  source: Schema.NullOr(Schema.Literals(["synthetic", "live"])),
  epoch: Schema.NullOr(Schema.Int),
  lastCheckedAt: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
  nextCheckAt: Schema.NullOr(Schema.String),
  cadenceHours: Schema.NullOr(Schema.Int),
  expiresAt: Schema.NullOr(Schema.String),
  taskCount: Schema.Int,
  usage: Schema.Struct({
    reads: Schema.Int,
    refreshes: Schema.Int,
    failures: Schema.Int,
    notesReads: Schema.Int,
    returnedTasks: Schema.Int,
    backgroundModelCalls: Schema.Literal(0),
  }),
}) {}
