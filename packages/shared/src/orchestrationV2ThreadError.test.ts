import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import { providerRetryCountdown } from "./orchestrationV2ThreadError.ts";

describe("providerRetryCountdown", () => {
  const retry = {
    status: "running",
    updatedAt: DateTime.makeUnsafe(1000),
    retry: { attempt: 2, maxAttempts: null, retryDelayMs: 5000 },
  } as const;
  it("counts down from this attempt's update and shows when it is sending", () => {
    expect(providerRetryCountdown(retry, 1000)).toBe("Retrying in 5s · attempt 2");
    expect(providerRetryCountdown(retry, 4001)).toBe("Retrying in 2s · attempt 2");
    expect(providerRetryCountdown(retry, 6000)).toBe("Retrying now · attempt 2");
    expect(providerRetryCountdown(retry, 9000)).toBe("Retrying now · attempt 2");
    expect(
      providerRetryCountdown(
        {
          ...retry,
          updatedAt: DateTime.makeUnsafe(9000),
          retry: { ...retry.retry, attempt: 3, retryDelayMs: 10000 },
        },
        9000,
      ),
    ).toBe("Retrying in 10s · attempt 3");
  });
  it("clears on success or cancellation", () => {
    expect(providerRetryCountdown({ ...retry, status: "completed" }, 1000)).toBeNull();
    expect(providerRetryCountdown({ ...retry, status: "interrupted" }, 1000)).toBeNull();
    expect(providerRetryCountdown({ ...retry, retry: undefined }, 1000)).toBeNull();
  });
});
