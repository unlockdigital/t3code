import { sha256 } from "@noble/hashes/sha2";
import { providerClients } from "../settings/providerDriverMeta";
import type { UsageAccount } from "@t3tools/shared/usageLimits";
import type { UsagePagePreferences } from "./usagePagePreferences";

// Full digests keep arbitrary hub identifiers out of storage and make collisions negligible.
export function usageAccountOrderId(key: string): string {
  return Array.from(sha256(new TextEncoder().encode(key)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function providerLabel(account: UsageAccount) {
  return account.driver === "antigravity"
    ? "Google"
    : (providerClients.get(account.driver)?.label ?? "Custom provider");
}

type Sort = NonNullable<UsagePagePreferences["accountSort"]>;

export function orderUsageAccounts(
  accounts: readonly UsageAccount[],
  sort: Sort,
  saved: readonly string[],
) {
  if (sort === "default") return accounts;
  if (sort === "custom") {
    const rank = new Map([...new Set(saved)].map((key, index) => [key, index]));
    return [...accounts].sort(
      (a, b) =>
        (rank.get(usageAccountOrderId(a.key)) ?? Infinity) -
        (rank.get(usageAccountOrderId(b.key)) ?? Infinity),
    );
  }
  return [...accounts].sort(
    (a, b) =>
      (sort === "provider"
        ? providerLabel(a).localeCompare(providerLabel(b), undefined, {
            sensitivity: "base",
            numeric: true,
          })
        : 0) ||
      a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true }) ||
      a.key.localeCompare(b.key),
  );
}

// Replace only visible slots; retain filtered and temporarily missing accounts.
export function moveUsageAccount(
  saved: readonly string[],
  visible: readonly string[],
  from: string,
  to: string,
): string[] | null {
  if (new Set(visible).size !== visible.length) return null;
  const start = visible.indexOf(from);
  const end = visible.indexOf(to);
  if (start < 0 || end < 0 || start === end) return null;
  const moved = [...visible];
  moved.splice(end, 0, moved.splice(start, 1)[0]!);
  const visibleSet = new Set(visible);
  const uniqueSaved = [...new Set(saved)];
  const all = [...uniqueSaved, ...visible.filter((key) => !uniqueSaved.includes(key))];
  let index = 0;
  return all.map((key) => (visibleSet.has(key) ? moved[index++]! : key));
}
