import type { ServerProviderUsageLimits } from "@t3tools/contracts";
import { makeUnavailableUsageLimits } from "@t3tools/provider-core/server/usageLimits";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

const Balance = Schema.Struct({ balance_dollars: Schema.Finite });
const MonthlyUsage = Schema.Struct({ cost: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)) });
const Caller = Schema.Struct({
  context_type: Schema.Literals(["personal", "organization"]),
  user_id: Schema.String,
  organization: Schema.NullOr(Schema.Struct({ id: Schema.String })),
});

export const readTinfoilUsageLimits = Effect.fn("readTinfoilUsageLimits")(function* (input: {
  readonly checkedAt: string;
  readonly adminKey: string;
  readonly monthlyBudgetUsd?: number;
}) {
  const externalUsage = { label: "Tinfoil billing", url: "https://dash.tinfoil.sh/?tab=billing" };
  const unavailable = (
    message: string,
    reason: "unsupported" | "probeFailed" = "probeFailed",
  ): ServerProviderUsageLimits => ({
    ...makeUnavailableUsageLimits({ checkedAt: input.checkedAt, reason, message }),
    externalUsage,
  });
  const key = input.adminKey.trim();
  if (!key)
    return unavailable(
      "Connect a Tinfoil billing admin key to read your account balance automatically.",
      "unsupported",
    );
  if (!key.startsWith("admin_") || /\s/.test(key))
    return unavailable(
      "Tinfoil billing requires an admin key. Inference keys cannot read account credits.",
    );
  let failureMessage = "Tinfoil billing could not be refreshed. Try again.";
  let balanceOnly: ServerProviderUsageLimits | undefined;
  return yield* Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const get = (path: string) =>
      client.execute(
        HttpClientRequest.get(`https://api.tinfoil.sh${path}`).pipe(
          HttpClientRequest.bearerToken(key),
        ),
      );
    const response = yield* get("/api/billing/credits");
    if (response.status === 401)
      failureMessage = "The Tinfoil billing key was rejected. Update the admin key.";
    if (response.status === 403)
      failureMessage =
        "This Tinfoil key cannot read billing. Use an unscoped admin key for this account.";
    if (response.status === 429)
      failureMessage = "Tinfoil billing is rate limited. Refresh again shortly.";
    const balance = yield* HttpClientResponse.filterStatusOk(response).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Balance)),
    );
    const monthStart = DateTime.startOf(DateTime.makeUnsafe(input.checkedAt), "month");
    const periodStart = DateTime.formatIso(monthStart);
    const periodEnd = DateTime.formatIso(DateTime.add(monthStart, { months: 1 }));
    const usageQuery = new URLSearchParams({ start: periodStart, end: input.checkedAt });
    const monthlySpend = {
      budgetUsd: input.monthlyBudgetUsd ?? 25,
      spentUsd: null,
      periodStart,
      periodEnd,
      checkedAt: input.checkedAt,
    };
    balanceOnly = {
      checkedAt: input.checkedAt,
      windows: [],
      externalUsage,
      prepaidBalance: { remainingUsd: balance.balance_dollars, checkedAt: input.checkedAt },
      monthlySpend,
    };
    const [usage, caller] = yield* Effect.all(
      [
        get(`/api/billing/usage?${usageQuery}`).pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap(HttpClientResponse.schemaBodyJson(MonthlyUsage)),
          Effect.orElseSucceed(() => undefined),
        ),
        get("/api/auth/context").pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Caller)),
          Effect.orElseSucceed(() => undefined),
        ),
      ],
      { concurrency: "unbounded" },
    );
    const owner =
      caller?.context_type === "organization" ? caller.organization?.id : caller?.user_id;
    const crypto = yield* Crypto.Crypto;
    const credentialFingerprint = owner
      ? yield* crypto
          .digest("SHA-256", new TextEncoder().encode(`tinfoil\0${caller!.context_type}:${owner}`))
          .pipe(Effect.map(Hex.encode), Effect.orDie)
      : undefined;
    const limits: ServerProviderUsageLimits = {
      checkedAt: input.checkedAt,
      windows: [],
      externalUsage,
      prepaidBalance: {
        remainingUsd: balance.balance_dollars,
        checkedAt: input.checkedAt,
      },
      monthlySpend: {
        ...monthlySpend,
        spentUsd: usage?.cost ?? null,
      },
      ...(credentialFingerprint ? { credentialFingerprint } : {}),
    };
    return limits;
  }).pipe(
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
    Effect.timeout("5 seconds"),
    // A slow auxiliary read still leaves the independently verified balance usable.
    Effect.orElseSucceed(() => balanceOnly ?? unavailable(failureMessage)),
  );
});
