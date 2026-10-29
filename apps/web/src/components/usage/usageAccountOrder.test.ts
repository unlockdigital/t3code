import { describe, expect, it } from "vite-plus/test";
import type { UsageAccount } from "@t3tools/shared/usageLimits";
import { moveUsageAccount, orderUsageAccounts, usageAccountOrderId } from "./usageAccountOrder";

const account = (key: string, label: string, driver: string) =>
  ({ key, label, driver }) as UsageAccount;
const accounts = [
  account("a", "Zoe", "codex"),
  account("b", "Amy", "claudeAgent"),
  account("c", "Bob", "codex"),
];
const keys = (items: readonly UsageAccount[]) => items.map((item) => item.key);

describe("usage account ordering", () => {
  it("sorts presets and appends new accounts to saved custom order", () => {
    expect(keys(orderUsageAccounts(accounts, "default", ["c"]))).toEqual(["a", "b", "c"]);
    expect(keys(orderUsageAccounts(accounts, "name", []))).toEqual(["b", "c", "a"]);
    expect(
      keys(
        orderUsageAccounts(
          [account("10", "Account 10", "codex"), account("2", "Account 2", "codex")],
          "name",
          [],
        ),
      ),
    ).toEqual(["2", "10"]);
    expect(keys(orderUsageAccounts(accounts, "provider", []))).toEqual(["b", "c", "a"]);
    expect(
      keys(orderUsageAccounts(accounts, "custom", ["missing", "c", "a"].map(usageAccountOrderId))),
    ).toEqual(["c", "a", "b"]);
  });
  it("hashes identities including their environment and handles duplicate saved keys", () => {
    const first = usageAccountOrderId('["env-a","hub","a@example.com"]');
    const second = usageAccountOrderId('["env-b","hub","a@example.com"]');
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain("example");
    expect(
      keys(
        orderUsageAccounts(accounts, "custom", [
          usageAccountOrderId("c"),
          usageAccountOrderId("a"),
          usageAccountOrderId("c"),
        ]),
      ),
    ).toEqual(["c", "a", "b"]);
  });
  it("moves visible accounts through their slots while keeping missing accounts", () => {
    expect(moveUsageAccount(["a", "hidden", "b", "missing"], ["a", "b", "c"], "c", "a")).toEqual([
      "c",
      "hidden",
      "a",
      "missing",
      "b",
    ]);
    expect(moveUsageAccount(["a", "b"], ["a", "b"], "gone", "a")).toBeNull();
    expect(moveUsageAccount([], ["a", "b"], "a", "gone")).toBeNull();
    expect(moveUsageAccount([], ["a", "a"], "a", "a")).toBeNull();
  });
  it("starts a manual move from the displayed preset and restores returning accounts", () => {
    const saved = ["a", "hidden", "c", "b"].map(usageAccountOrderId);
    const visible = orderUsageAccounts(accounts, "name", saved).map((item) =>
      usageAccountOrderId(item.key),
    );
    const moved = moveUsageAccount(
      saved,
      visible,
      usageAccountOrderId("a"),
      usageAccountOrderId("b"),
    )!;
    expect(moved).toEqual(["a", "hidden", "b", "c"].map(usageAccountOrderId));
    const returning = [...accounts, account("hidden", "Returned", "codex")];
    expect(keys(orderUsageAccounts(returning, "custom", moved))).toEqual(["a", "hidden", "b", "c"]);
    expect(
      keys(
        orderUsageAccounts(
          returning.map((item) => ({ ...item, label: "Renamed" })),
          "custom",
          moved,
        ),
      ),
    ).toEqual(["a", "hidden", "b", "c"]);
  });

  it("resolves equal labels consistently across refreshes", () => {
    const sameNames = [account("b", "Work", "codex"), account("a", "Work", "codex")];
    for (const sort of ["name", "provider"] as const) {
      expect(keys(orderUsageAccounts(sameNames, sort, []))).toEqual(["a", "b"]);
      expect(keys(orderUsageAccounts(sameNames.toReversed(), sort, []))).toEqual(["a", "b"]);
    }
  });
});
