import { describe, expect, it } from "vite-plus/test";
import { claudePlatformCreditsToLimits } from "./claudePlatformBilling.ts";

const checkedAt = "2025-02-16T12:00:00.000Z";
const money = (amount: number, exponent = 2) => ({
  credits: { amount_minor: amount, exponent },
  money: null,
});
const tranche = (remaining: number, granted: number) => ({
  currency: "USD",
  scope: { kind: "unscoped", applies_to: [] },
  remaining: money(remaining),
  granted: money(granted),
  expires_at: "2027-02-16T00:00:00Z",
});
const credits = () => ({
  currency: "USD",
  amount: 6720,
  balance: money(6720),
  promo_tranches: [],
  tranches: [tranche(6719, 9600)],
});

describe("Claude Console prepaid credits", () => {
  it("uses authoritative minor units and the complete active grant pool", () => {
    const result = claudePlatformCreditsToLimits({ checkedAt, credits: credits() });
    expect(result.prepaidBalance).toEqual({ remainingUsd: 67.2, totalGrantedUsd: 96 });
    expect(result.windows).toEqual([]);
    expect(result.unavailable).toBeUndefined();
  });
  it("keeps a verified zero distinct from missing, malformed, and non-USD balances", () => {
    expect(
      claudePlatformCreditsToLimits({
        checkedAt,
        credits: { ...credits(), amount: 0, balance: money(0), tranches: [] },
      }).prepaidBalance?.remainingUsd,
    ).toBe(0);
    for (const value of [
      null,
      {},
      { ...credits(), currency: "EUR" },
      { ...credits(), balance: money(1, 9) },
    ]) {
      const result = claudePlatformCreditsToLimits({ checkedAt, credits: value });
      expect(result.prepaidBalance).toBeUndefined();
      expect(result.unavailable?.reason).toBe("probeFailed");
    }
  });
  it("shows dollars while withholding a percentage for incomplete or scoped grants", () => {
    for (const value of [
      { ...credits(), tranches: [] },
      { ...credits(), tranches: [tranche(3200, 9600)] },
      { ...credits(), promo_tranches: [{ scope: "model-specific" }] },
      { ...credits(), tranches: [{ ...tranche(6720, 9600), scope: { kind: "scoped" } }] },
    ]) {
      expect(claudePlatformCreditsToLimits({ checkedAt, credits: value }).prepaidBalance).toEqual({
        remainingUsd: 67.2,
      });
    }
  });
  it("supports older balance responses and ignores expired grants", () => {
    expect(
      claudePlatformCreditsToLimits({ checkedAt, credits: { currency: "USD", amount: 7310 } })
        .prepaidBalance,
    ).toEqual({ remainingUsd: 73.1 });
    const result = claudePlatformCreditsToLimits({
      checkedAt,
      credits: {
        ...credits(),
        tranches: [
          ...credits().tranches,
          { ...tranche(0, 8100), expires_at: "2024-01-01T00:00:00Z" },
        ],
      },
    });
    expect(result.prepaidBalance).toEqual({ remainingUsd: 67.2, totalGrantedUsd: 96 });
  });
});
