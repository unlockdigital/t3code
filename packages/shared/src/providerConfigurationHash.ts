import { sha256 } from "@noble/hashes/sha2";
import * as Hex from "effect/encoding/Hex";

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

export function providerConfigurationHash(configuration: unknown): string {
  return Hex.encode(
    sha256(new TextEncoder().encode(JSON.stringify(canonicalValue(configuration)))),
  );
}

export function privateInferenceConfigurationHash(configuration: unknown): string {
  if (
    configuration !== null &&
    typeof configuration === "object" &&
    "config" in configuration &&
    configuration.config !== null &&
    typeof configuration.config === "object"
  ) {
    // Billing authorization and tracking budgets never change where inference is sent.
    const {
      tinfoilAdminKey: _billing,
      tinfoilMonthlyBudgetUsd: _budget,
      ...inference
    } = configuration.config as Record<string, unknown>;
    return providerConfigurationHash({ ...configuration, config: inference });
  }
  return providerConfigurationHash(configuration);
}
