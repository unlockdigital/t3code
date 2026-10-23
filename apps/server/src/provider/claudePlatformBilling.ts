import {
  ClaudeConsoleBillingConnection,
  ClaudeConsoleBillingReadError,
  type ServerProviderUsageLimits,
} from "@t3tools/contracts";
import { makeUnavailableUsageLimits } from "@t3tools/provider-core/server/usageLimits";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Hex from "effect/encoding/Hex";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export class ClaudeConsoleBillingReader extends Context.Service<
  ClaudeConsoleBillingReader,
  {
    readonly read: (
      connection: ClaudeConsoleBillingConnection,
    ) => Effect.Effect<unknown, ClaudeConsoleBillingReadError>;
  }
>()("t3/provider/claudePlatformBilling/ClaudeConsoleBillingReader") {}

const Amount = Schema.Struct({
  amount_minor: Schema.Finite.check(Schema.isInt()),
  exponent: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 4 })),
});
const CreditAmount = Schema.Struct({ credits: Amount });
const Credits = Schema.Struct({
  currency: Schema.Literal("USD"),
  amount: Schema.optionalKey(Schema.Finite),
  balance: Schema.optionalKey(Schema.Unknown),
  tranches: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  promo_tranches: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});
const Tranche = Schema.Struct({
  currency: Schema.Literal("USD"),
  scope: Schema.Struct({ kind: Schema.Literal("unscoped") }),
  granted: CreditAmount,
  remaining: CreditAmount,
  expires_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const decodeCredits = Schema.decodeUnknownOption(Credits);
const decodeAmount = Schema.decodeUnknownOption(CreditAmount);
const decodeTranche = Schema.decodeUnknownOption(Tranche);
const ConnectionJson = Schema.fromJsonString(ClaudeConsoleBillingConnection);
const decodeConnection = Schema.decodeUnknownOption(ConnectionJson);
export const encodeClaudeConsoleBillingConnection = Schema.encodeSync(ConnectionJson);
const externalUsage = {
  label: "Claude Console billing",
  url: "https://platform.claude.com/settings/billing",
};
const dollars = (amount: typeof Amount.Type) => amount.amount_minor / 10 ** amount.exponent;

export function decodeClaudeConsoleBillingConnection(value: string) {
  return Option.getOrUndefined(decodeConnection(value));
}

export function claudePlatformCreditsToLimits(input: {
  readonly checkedAt: string;
  readonly credits: unknown;
}): ServerProviderUsageLimits {
  const unavailable = (): ServerProviderUsageLimits => ({
    ...makeUnavailableUsageLimits({
      checkedAt: input.checkedAt,
      reason: "probeFailed",
      message: new ClaudeConsoleBillingReadError({ reason: "invalidResponse" }).message,
    }),
    externalUsage,
  });
  const decoded = decodeCredits(input.credits);
  if (Option.isNone(decoded)) return unavailable();
  const data = decoded.value;
  const amount =
    data.balance === undefined ? undefined : Option.getOrUndefined(decodeAmount(data.balance));
  if (data.balance !== undefined && amount === undefined) return unavailable();
  const remainingUsd = amount
    ? dollars(amount.credits)
    : data.amount === undefined
      ? undefined
      : data.amount / 100;
  if (remainingUsd === undefined || !Number.isFinite(remainingUsd)) return unavailable();

  let complete = (data.tranches?.length ?? 0) > 0 && (data.promo_tranches?.length ?? 0) === 0;
  let grantedUsd = 0;
  let trancheRemainingUsd = 0;
  const now = Date.parse(input.checkedAt);
  for (const raw of data.tranches ?? []) {
    const parsed = decodeTranche(raw);
    if (Option.isNone(parsed)) {
      complete = false;
      continue;
    }
    const entry = parsed.value;
    if (entry.expires_at) {
      const expiry = Date.parse(entry.expires_at);
      if (!Number.isFinite(expiry)) {
        complete = false;
        continue;
      }
      if (expiry <= now) continue;
    }
    const granted = dollars(entry.granted.credits);
    const remaining = dollars(entry.remaining.credits);
    if (granted < 0 || remaining < 0 || remaining > granted) {
      complete = false;
      continue;
    }
    grantedUsd += granted;
    trancheRemainingUsd += remaining;
  }
  // Console's total can differ from its tranche sum by one minor unit while charges settle.
  const totalGrantedUsd =
    complete &&
    grantedUsd > 0 &&
    grantedUsd >= remainingUsd &&
    Math.abs(Math.round(trancheRemainingUsd * 100) - Math.round(remainingUsd * 100)) <= 1
      ? grantedUsd
      : undefined;
  return {
    checkedAt: input.checkedAt,
    windows: [],
    externalUsage,
    prepaidBalance: { remainingUsd, ...(totalGrantedUsd === undefined ? {} : { totalGrantedUsd }) },
  };
}

export const readClaudePlatformBilling = Effect.fn("readClaudePlatformBilling")(function* (input: {
  readonly connection: ClaudeConsoleBillingConnection;
  readonly checkedAt: string;
  readonly read: (
    connection: ClaudeConsoleBillingConnection,
  ) => Effect.Effect<unknown, ClaudeConsoleBillingReadError>;
}) {
  const limits = yield* input.read(input.connection).pipe(
    Effect.map((credits) => claudePlatformCreditsToLimits({ checkedAt: input.checkedAt, credits })),
    Effect.catch((error) =>
      Effect.succeed<ServerProviderUsageLimits>({
        ...makeUnavailableUsageLimits({
          checkedAt: input.checkedAt,
          reason: "probeFailed",
          message: error.message,
        }),
        externalUsage,
      }),
    ),
  );
  if (!limits.prepaidBalance) return limits;
  const crypto = yield* Crypto.Crypto;
  const fingerprint = yield* crypto
    .digest(
      "SHA-256",
      new TextEncoder().encode(`claude-console\0${input.connection.organizationId}`),
    )
    .pipe(Effect.map(Hex.encode), Effect.orDie);
  return { ...limits, credentialFingerprint: fingerprint };
});
