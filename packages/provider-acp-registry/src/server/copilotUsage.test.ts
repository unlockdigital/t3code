import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { AcpRegistrySettings } from "../settings.ts";
import * as AcpRegistrySupport from "./AcpRegistrySupport.ts";
import { copilotUsageLimits, isCopilotAgent, readCopilotUsageLimits } from "./copilotUsage.ts";

const checkedAt = "2026-10-26T15:00:00.000Z";
const decodeSettings = Schema.decodeSync(AcpRegistrySettings);
const quota = (fields: Record<string, unknown> = {}) => ({
  entitlementRequests: 300,
  usedRequests: 12,
  hasQuota: true,
  isUnlimitedEntitlement: false,
  resetDate: "2026-11-01T00:00:00Z",
  ...fields,
});

describe("Copilot account usage", () => {
  it("keeps request-based quotas separate from AI credits", () => {
    const limits = copilotUsageLimits(
      { quotaSnapshots: { premium_interactions: quota() } },
      checkedAt,
    );
    expect(limits.windows).toEqual([
      {
        id: "copilot_premium_interactions",
        kind: "monthly",
        label: "Premium requests · 12 / 300",
        usedPercent: 4,
        resetsAt: "2026-11-01T00:00:00.000Z",
      },
    ]);
    expect(limits.creditBalance).toBeUndefined();
  });

  it("preserves unlimited entitlement flags and the legacy -1 sentinel", () => {
    const limits = copilotUsageLimits(
      {
        quotaSnapshots: {
          chat: quota({ entitlementRequests: 0, usedRequests: 900, isUnlimitedEntitlement: true }),
          completions: quota({ entitlementRequests: -1, usedRequests: 4000 }),
        },
      },
      checkedAt,
    );
    expect(limits.unavailable).toBeUndefined();
    expect(limits.windows.map((w) => [w.label, w.usedPercent, w.resetsAt])).toEqual([
      ["Chat · Unlimited", 0, undefined],
      ["Completions · Unlimited", 0, undefined],
    ]);
  });

  it("clamps exhausted credits and leaves a malformed reset unknown", () => {
    const limits = copilotUsageLimits(
      {
        quotaSnapshots: {
          premium_interactions: quota({
            entitlementRequests: 1500,
            usedRequests: 1510,
            tokenBasedBilling: true,
            resetDate: "unknown",
          }),
        },
      },
      checkedAt,
    );
    expect(limits.windows[0]?.usedPercent).toBe(100);
    expect(limits.windows[0]?.resetsAt).toBeUndefined();
    expect(limits.creditBalance).toEqual({ hasCredits: false, unlimited: false, balance: "0" });
  });

  it("leaves missing, unavailable, zero, and malformed quotas unknown", () => {
    for (const payload of [
      null,
      {},
      { quotaSnapshots: {} },
      {
        quotaSnapshots: {
          premium_interactions: quota({ hasQuota: false }),
          chat: quota({ entitlementRequests: 0 }),
          completions: quota({ usedRequests: NaN }),
        },
      },
    ]) {
      const limits = copilotUsageLimits(payload, checkedAt);
      expect(limits.windows).toEqual([]);
      expect(limits.unavailable?.reason).toBe("probeFailed");
    }
  });

  it("recognizes registry and local Copilot commands without selecting unrelated ACP agents", () => {
    expect(isCopilotAgent(decodeSettings({ agentId: "github-copilot-cli" }))).toBe(true);
    expect(
      isCopilotAgent(decodeSettings({ source: "local", commandPath: "C:\\tools\\copilot.cmd" })),
    ).toBe(true);
    expect(isCopilotAgent(decodeSettings({ agentId: "gemini" }))).toBe(false);
    expect(
      isCopilotAgent(decodeSettings({ source: "local", commandPath: "/tools/my-copilot-wrapper" })),
    ).toBe(false);
  });

  it.effect("avoids quota RPC for disabled Copilot and unrelated ACP instances", () =>
    Effect.gen(function* () {
      for (const settings of [
        decodeSettings({ agentId: "github-copilot-cli", enabled: false }),
        decodeSettings({ agentId: "gemini" }),
      ]) {
        expect(
          yield* readCopilotUsageLimits({ settings, cwd: "/test", environment: {} }),
        ).toBeUndefined();
      }
    }).pipe(
      Effect.provideService(
        AcpRegistrySupport.AcpRegistryCatalog,
        AcpRegistrySupport.AcpRegistryCatalog.of({
          inspect: () => Effect.die("unused"),
          search: () => Effect.die("unused"),
          prepare: () => Effect.die("unused"),
          uninstallManagedBinary: () => Effect.die("unused"),
          resolve: () => Effect.die("Disabled and unrelated providers must not resolve Copilot"),
        }),
      ),
    ),
  );

  it.effect("keeps resolver failures explicit without exposing their credentials", () =>
    Effect.gen(function* () {
      const catalog = AcpRegistrySupport.AcpRegistryCatalog.of({
        inspect: () => Effect.die("unused"),
        search: () => Effect.die("unused"),
        prepare: () => Effect.die("unused"),
        uninstallManagedBinary: () => Effect.die("unused"),
        resolve: () =>
          Effect.fail(
            new AcpRegistrySupport.AcpRegistryError({
              reason: "runner_unavailable",
              detail: "private credential",
            }),
          ),
      });
      const limits = yield* readCopilotUsageLimits({
        settings: decodeSettings({ agentId: "github-copilot-cli" }),
        cwd: "/test",
        environment: {},
      }).pipe(Effect.provideService(AcpRegistrySupport.AcpRegistryCatalog, catalog));
      expect(limits?.unavailable?.reason).toBe("probeFailed");
      expect(JSON.stringify(limits)).not.toContain("private credential");
      expect(limits?.externalUsage?.url).toBe("https://github.com/settings/copilot");
    }),
  );
});
