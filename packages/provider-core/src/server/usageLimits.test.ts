import { describe, expect, it } from "vite-plus/test";

import { applyUsageLimitsUpdate, resolveUsageLimitsAfterProbe } from "./usageLimits.ts";

const checkedAt = "2026-09-03T12:00:00.000Z";
const session = {
  id: "five_hour",
  kind: "session",
  label: "Session",
  usedPercent: 40,
  windowDurationMins: 300,
  resetsAt: "2026-09-03T14:00:00.000Z",
} as const;
const weekly = {
  id: "seven_day",
  kind: "weekly",
  label: "Weekly",
  usedPercent: 20,
  windowDurationMins: 10_080,
} as const;
const published = { checkedAt, windows: [session, weekly] };

describe("applyUsageLimitsUpdate", () => {
  it("updates and clears credit balances while preserving other account metadata", () => {
    const previous = {
      ...published,
      creditBalance: { hasCredits: true, unlimited: false, balance: "10" },
      externalUsage: { label: "Billing", url: "https://example.invalid/billing" },
    };
    const next = applyUsageLimitsUpdate({
      previous,
      checkedAt,
      update: { windows: [], creditBalance: { hasCredits: true, unlimited: false, balance: "9" } },
    });
    expect(next?.creditBalance?.balance).toBe("9");
    expect(next?.externalUsage).toEqual(previous.externalUsage);
    expect(
      applyUsageLimitsUpdate({
        previous: next,
        checkedAt,
        update: {
          windows: [],
          creditBalance: { hasCredits: true, unlimited: false, balance: "9" },
        },
      }),
    ).toBe(next);
    expect(
      applyUsageLimitsUpdate({
        previous: next,
        checkedAt,
        update: { windows: [], creditBalance: null },
      })?.creditBalance,
    ).toBeUndefined();
    expect(
      applyUsageLimitsUpdate({
        previous,
        checkedAt,
        update: { windows: [{ ...session, usedPercent: 55 }] },
      })?.creditBalance,
    ).toEqual(previous.creditBalance);
  });

  it("returns the published object itself when no window moved", () => {
    // Codex repeats the same numbers beside every token-usage tick; the
    // ingestion path relies on identity to skip the publish.
    const next = applyUsageLimitsUpdate({
      previous: published,
      checkedAt: "2026-09-03T12:00:05.000Z",
      update: {
        windows: [
          { ...weekly },
          { id: "five_hour", kind: "session", label: "Session", usedPercent: 40 },
        ],
      },
    });
    expect(next).toBe(published);
  });

  it("upserts by id and keeps the reset a percent-only update omits", () => {
    const next = applyUsageLimitsUpdate({
      previous: published,
      checkedAt: "2026-09-03T12:00:05.000Z",
      update: {
        windows: [{ id: "five_hour", kind: "session", label: "Session", usedPercent: 55 }],
      },
    });
    expect(next).not.toBe(published);
    expect(next).toEqual({
      checkedAt: "2026-09-03T12:00:05.000Z",
      windows: [{ ...session, usedPercent: 55 }, weekly],
    });
  });

  it("leaves an unsupported account and an empty update alone", () => {
    const unsupported = { checkedAt, windows: [], unavailable: { reason: "unsupported" as const } };
    expect(
      applyUsageLimitsUpdate({ previous: unsupported, checkedAt, update: { windows: [session] } }),
    ).toBe(unsupported);
    expect(
      applyUsageLimitsUpdate({ previous: published, checkedAt, update: { windows: [] } }),
    ).toBe(published);
  });

  it("marks a first sparse update as unavailable", () => {
    expect(
      applyUsageLimitsUpdate({ previous: undefined, checkedAt, update: { windows: [weekly] } }),
    ).toEqual({ checkedAt, windows: [weekly], unavailable: { reason: "probeFailed" } });
  });

  it("preserves reset credits when a streamed window update changes usage", () => {
    const resetCredits = { availableCount: 2, nextExpiresAt: "2026-10-01T00:00:00.000Z" };
    const next = applyUsageLimitsUpdate({
      previous: { ...published, resetCredits },
      checkedAt: "2026-09-03T12:00:05.000Z",
      update: { windows: [{ ...session, usedPercent: 55 }] },
    });

    expect(next).toEqual({
      checkedAt: "2026-09-03T12:00:05.000Z",
      windows: [{ ...session, usedPercent: 55 }, weekly],
      resetCredits,
    });
  });
});

describe("resolveUsageLimitsAfterProbe", () => {
  it("uses read order for windows while taking metadata from the successful probe", () => {
    const live = {
      checkedAt: "2026-09-03T12:00:05.000Z",
      windows: [
        { ...session, usedPercent: 95 },
        { ...weekly, usedPercent: 70 },
      ],
      resetCredits: { availableCount: 2 },
      externalUsage: { label: "Old dashboard", url: "https://example.com/old" },
    };
    const probed = {
      ...published,
      windows: [{ ...session, usedPercent: 0 }],
      resetCredits: { availableCount: 1 },
      externalUsage: { label: "Usage dashboard", url: "https://example.com/usage" },
    };

    expect(resolveUsageLimitsAfterProbe({ published: live, probed })).toEqual({
      ...probed,
      checkedAt: live.checkedAt,
      windows: live.windows,
    });

    const sameTime = { ...probed, checkedAt: live.checkedAt };
    const newer = { ...probed, checkedAt: "2026-09-03T12:00:06.000Z" };
    expect(resolveUsageLimitsAfterProbe({ published: live, probed: sameTime })).toEqual(sameTime);
    expect(resolveUsageLimitsAfterProbe({ published: live, probed: newer })).toEqual(newer);
  });

  it("keeps the last good windows through a failed probe but not an unsupported one", () => {
    const failed = { checkedAt, windows: [], unavailable: { reason: "probeFailed" as const } };
    const unsupported = { checkedAt, windows: [], unavailable: { reason: "unsupported" as const } };
    expect(resolveUsageLimitsAfterProbe({ published, probed: failed })).toBe(published);
    expect(resolveUsageLimitsAfterProbe({ published, probed: unsupported })).toBe(unsupported);
    expect(resolveUsageLimitsAfterProbe({ published: undefined, probed: failed })).toBe(failed);
  });
});

describe("prepaid balance probe freshness", () => {
  const balance = {
    ...published,
    windows: [],
    prepaidBalance: { remainingUsd: 67.2, totalGrantedUsd: 96 },
  };
  it("keeps the original balance timestamp and exposes repeated refresh failures", () => {
    const probed = {
      checkedAt: "2026-09-03T12:05:00Z",
      windows: [],
      unavailable: { reason: "probeFailed" as const, message: "Billing unavailable" },
    };
    const first = resolveUsageLimitsAfterProbe({ published: balance, probed });
    expect(first?.prepaidBalance).toEqual(balance.prepaidBalance);
    expect(first?.checkedAt).toBe(balance.checkedAt);
    expect(first?.unavailable).toEqual(probed.unavailable);
    const repeated = resolveUsageLimitsAfterProbe({
      published: first,
      probed: { ...probed, checkedAt: "2026-09-03T12:10:00Z" },
    });
    expect(repeated?.prepaidBalance).toEqual(balance.prepaidBalance);
    expect(repeated?.checkedAt).toBe(balance.checkedAt);
    expect(
      resolveUsageLimitsAfterProbe({
        published: first,
        probed: { ...probed, unavailable: { reason: "unsupported" } },
      })?.prepaidBalance,
    ).toBeUndefined();
  });
  it("keeps the newer balance when an older probe completes after it", () => {
    const next = resolveUsageLimitsAfterProbe({
      published: balance,
      probed: {
        ...balance,
        checkedAt: "2026-09-03T11:00:00Z",
        prepaidBalance: { remainingUsd: 96, totalGrantedUsd: 96 },
      },
    });
    expect(next?.prepaidBalance?.remainingUsd).toBe(67.2);
    expect(next?.checkedAt).toBe(balance.checkedAt);
  });
});
