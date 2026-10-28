import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { usageAccountOrderId } from "./usageAccountOrder";
import { readUsagePagePreferences, saveUsagePagePreferences } from "./usagePagePreferences";

const key = "t3code:usage-page-preferences:v1";
let values: Map<string, string>;
let storage: Pick<Storage, "getItem" | "setItem">;

beforeEach(() => {
  values = new Map();
  storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
  vi.stubGlobal("window", { localStorage: storage });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Usage page preferences", () => {
  it("persists Usage density while preserving earlier saved selections", () => {
    saveUsagePagePreferences({ metric: "limits", windowDays: 30, density: "comfortable" });
    expect(readUsagePagePreferences().density).toBe("comfortable");
    values.set(key, '{"metric":"limits","windowDays":30}');
    expect(readUsagePagePreferences().density ?? "compact").toBe("compact");
  });

  it("round-trips hidden providers and reads older saves without them", () => {
    saveUsagePagePreferences({ metric: "cost", windowDays: 7, hiddenProviders: ["codex"] });
    expect(readUsagePagePreferences().hiddenProviders).toEqual(["codex"]);

    values.set(key, '{"metric":"tokens","windowDays":30}');
    expect(readUsagePagePreferences()).toEqual({ metric: "tokens", windowDays: 30 });
  });

  it("round-trips account order and preserves it across preset changes", () => {
    saveUsagePagePreferences({
      metric: "limits",
      windowDays: 30,
      accountSort: "custom",
      accountOrder: [usageAccountOrderId("env-a/provider-a"), usageAccountOrderId("env-b/hub-b")],
    });
    const saved = readUsagePagePreferences();
    saveUsagePagePreferences({ ...saved, accountSort: "name" });
    expect(readUsagePagePreferences()).toEqual({ ...saved, accountSort: "name" });
  });

  // regression: #10189 an invalid saved usage selection was never replaced
  it.each([
    "not-json",
    '{"metric":"unknown","windowDays":7}',
    '{"metric":"cost","windowDays":365}',
    '{"metric":"limits","windowDays":30,"accountOrder":["email@example.com"]}',
    '{"metric":"limits","windowDays":30,"accountSort":"invalid"}',
  ])("replaces invalid preferences on the next save: %s", (value) => {
    values.set(key, value);
    expect(readUsagePagePreferences()).toEqual({ metric: "limits", windowDays: 30 });
    saveUsagePagePreferences({ metric: "tokens", windowDays: 7 });
    expect(readUsagePagePreferences()).toEqual({ metric: "tokens", windowDays: 7 });
  });
});
