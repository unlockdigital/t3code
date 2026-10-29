import { EnvironmentId, IsoDateTime, ProviderDriverKind } from "@t3tools/contracts";
import type { UsageAccount } from "@t3tools/shared/usageLimits";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { act, render } from "../../../test/render";
import { useEscapeToGoBack } from "../../hooks/useNavigateBack";
import "../../index.css";
import { UsageAccounts } from "./UsageAccounts";
import { usageAccountOrderId } from "./usageAccountOrder";
import {
  readUsagePagePreferences,
  saveUsagePagePreferences,
  type UsagePagePreferences,
} from "./usagePagePreferences";

const samples: readonly UsageAccount[] = [
  ["Work", "codex", 28],
  ["Personal", "claudeAgent", 52],
  ["Research", "codex", 12],
].map(([label, driver, usedPercent]) => ({
  key: String(label),
  label: String(label),
  driver: ProviderDriverKind.make(String(driver)),
  environmentId: EnvironmentId.make("sample"),
  environmentLabel: "This computer",
  category: "Subscription",
  status: "Connected",
  plan: undefined,
  resetCreditInput: undefined,
  limits: {
    checkedAt: IsoDateTime.make("2026-10-28T00:00:00Z"),
    windows: [
      { id: "primary", kind: "session", label: "Session", usedPercent: Number(usedPercent) },
    ],
  },
}));

const noop = () => {};

function Harness({
  accounts = samples,
  onBack = noop,
  persist = false,
}: {
  accounts?: readonly UsageAccount[];
  onBack?: () => void;
  persist?: boolean;
}) {
  const [preferences, setPreferences] = useState<UsagePagePreferences>(() =>
    persist ? readUsagePagePreferences() : { metric: "limits", windowDays: 30 },
  );
  useEscapeToGoBack(onBack);
  const update = (patch: Partial<UsagePagePreferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    if (persist) saveUsagePagePreferences(next);
  };
  return (
    <div className="p-5">
      <UsageAccounts
        accounts={accounts}
        now={0}
        density="compact"
        onDensityChange={() => {}}
        preferences={preferences}
        onPreferencesChange={update}
      />
    </div>
  );
}

function labels(container: HTMLElement) {
  return [...container.querySelectorAll("article")].map((row) => row.getAttribute("aria-label"));
}

it("sorts, arranges, preserves details and focus, and restores the saved custom order", async () => {
  await page.viewport(900, 800);
  await using screen = await render(<Harness />);
  await screen.getByRole("button", { name: "Details for Work" }).click();
  await screen.getByRole("button", { name: "Order", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Name A–Z" }).click();
  expect(labels(screen.container)).toEqual(["Personal", "Research", "Work"]);
  await screen.getByRole("button", { name: "Order", exact: true }).click();
  await page.getByRole("menuitem", { name: "Arrange accounts" }).click();
  await expect.element(screen.getByRole("button", { name: "Done" })).toHaveFocus();
  await screen.getByRole("button", { name: "Move Research up" }).click();
  expect(labels(screen.container)).toEqual(["Research", "Personal", "Work"]);
  await expect.element(screen.getByRole("button", { name: "Move Research up" })).toHaveFocus();
  await expect
    .element(screen.getByRole("button", { name: "Move Research up" }))
    .toHaveAttribute("aria-disabled", "true");
  await expect
    .element(screen.getByRole("button", { name: "Details for Work" }))
    .toHaveAttribute("aria-expanded", "true");
  await screen.getByRole("button", { name: "Done" }).click();
  await expect.element(screen.getByRole("button", { name: "Order", exact: true })).toHaveFocus();
  await screen.getByRole("button", { name: "Order", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Default" }).click();
  expect(labels(screen.container)).toEqual(["Work", "Personal", "Research"]);
  await screen.getByRole("button", { name: "Order", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "My order" }).click();
  expect(labels(screen.container)).toEqual(["Research", "Personal", "Work"]);
});

it("supports keyboard drag, cancels with Escape, and keeps Arrange Escape on the page", async () => {
  const onBack = vi.fn();
  await using screen = await render(<Harness onBack={onBack} />);
  await screen.getByRole("button", { name: "Order", exact: true }).click();
  await page.getByRole("menuitem", { name: "Arrange accounts" }).click();
  await screen.getByRole("button", { name: "Drag Work" }).click();
  await userEvent.keyboard("[Space]");
  await expect
    .element(screen.getByRole("button", { name: "Drag Work" }))
    .toHaveAttribute("aria-pressed", "true");
  await userEvent.keyboard("[ArrowDown]");
  await expect
    .element(page.getByText("Over position 2 of 3.", { exact: true }))
    .toBeInTheDocument();
  await userEvent.keyboard("[Space]");
  await vi.waitFor(() =>
    expect(labels(screen.container)).toEqual(["Personal", "Work", "Research"]),
  );
  await userEvent.keyboard("[Space]");
  await expect
    .element(screen.getByRole("button", { name: "Drag Work" }))
    .toHaveAttribute("aria-pressed", "true");
  await userEvent.keyboard("[ArrowDown]");
  await expect
    .element(page.getByText("Over position 3 of 3.", { exact: true }))
    .toBeInTheDocument();
  await userEvent.keyboard("[Escape]");
  expect(labels(screen.container)).toEqual(["Personal", "Work", "Research"]);
  expect(onBack).not.toHaveBeenCalled();
  await userEvent.keyboard("[Escape]");
  await expect.element(screen.getByRole("button", { name: "Order", exact: true })).toHaveFocus();
  expect(onBack).not.toHaveBeenCalled();
});

it("supports pointer dragging and retains local order across remounts at a narrow width", async () => {
  const storageKey = "t3code:usage-page-preferences:v1";
  window.localStorage.removeItem(storageKey);
  await page.viewport(360, 850);
  const onBack = vi.fn();
  await using screen = await render(<Harness persist onBack={onBack} />);
  await screen.getByRole("button", { name: "Order", exact: true }).click();
  await page.getByRole("menuitem", { name: "Arrange accounts" }).click();
  const handle = screen.getByRole("button", { name: "Drag Work" }).element();
  const start = handle.getBoundingClientRect();
  const target = screen
    .getByRole("button", { name: "Drag Research" })
    .element()
    .getBoundingClientRect();
  const pointer = (type: string, y: number) =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: start.x + start.width / 2,
      clientY: y,
    });
  await act(() => handle.dispatchEvent(pointer("pointerdown", start.y + start.height / 2)));
  await act(() => document.dispatchEvent(pointer("pointermove", start.y + start.height / 2 + 10)));
  await expect
    .element(screen.getByRole("button", { name: "Drag Work" }))
    .toHaveAttribute("aria-pressed", "true");
  await userEvent.keyboard("[Escape]");
  expect(onBack).not.toHaveBeenCalled();
  expect(labels(screen.container)).toEqual(["Work", "Personal", "Research"]);
  await expect
    .element(screen.getByRole("button", { name: "Drag Work" }))
    .not.toHaveAttribute("aria-pressed", "true");
  await act(() => handle.dispatchEvent(pointer("pointerdown", start.y + start.height / 2)));
  await act(() => document.dispatchEvent(pointer("pointermove", start.y + start.height / 2 + 10)));
  await expect
    .element(screen.getByRole("button", { name: "Drag Work" }))
    .toHaveAttribute("aria-pressed", "true");
  await act(() => document.dispatchEvent(pointer("pointermove", target.y + target.height / 2)));
  await expect
    .element(page.getByText("Over position 3 of 3.", { exact: true }))
    .toBeInTheDocument();
  await act(() => document.dispatchEvent(pointer("pointerup", target.y + target.height / 2)));
  await vi.waitFor(() =>
    expect(labels(screen.container)).toEqual(["Personal", "Research", "Work"]),
  );
  expect(readUsagePagePreferences().accountOrder).toEqual(
    ["Personal", "Research", "Work"].map(usageAccountOrderId),
  );
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  await screen.rerender(<Harness key="remount" persist />);
  expect(labels(screen.container)).toEqual(["Personal", "Research", "Work"]);
  window.localStorage.removeItem(storageKey);
});

it("cancels a drop when a refresh removes a snapshot account", async () => {
  window.localStorage.removeItem("t3code:usage-page-preferences:v1");
  await using screen = await render(<Harness persist />);
  await screen.getByRole("button", { name: "Order", exact: true }).click();
  await page.getByRole("menuitem", { name: "Arrange accounts" }).click();
  await screen.getByRole("button", { name: "Drag Work" }).click();
  await userEvent.keyboard("[Space]");
  await expect
    .element(screen.getByRole("button", { name: "Drag Work" }))
    .toHaveAttribute("aria-pressed", "true");
  await userEvent.keyboard("[ArrowDown]");
  await expect
    .element(page.getByText("Over position 2 of 3.", { exact: true }))
    .toBeInTheDocument();
  await screen.rerender(
    <Harness accounts={samples.filter((account) => account.label !== "Personal")} persist />,
  );
  await userEvent.keyboard("[Space]");
  expect(labels(screen.container)).toEqual(["Work", "Research"]);
  expect(readUsagePagePreferences().accountOrder).toBeUndefined();
});
