import { expect, it, vi } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import { act, fakeTimers, render } from "../../../test/render";
import { ProviderRetryStatus } from "./ProviderRetryStatus";

it("shows the retry countdown without expanding a row, then shows the attempt sending", async () => {
  // The shared clock subscribes during mount, so timers start before rendering.
  using _timers = fakeTimers({ now: 1000 });
  const item = {
    status: "running",
    updatedAt: DateTime.makeUnsafe(1000),
    retry: { attempt: 1, maxAttempts: null, retryDelayMs: 5000 },
    failure: {
      class: "provider_error",
      code: "provider.overloaded",
      message: "Selected model at capacity",
      retryable: true,
    },
  } as const;
  // Standalone status row has no route-dependent behavior.
  await using screen = await render(<ProviderRetryStatus item={item} />, { router: false });
  await expect.element(screen.getByText("Retrying in 5s · attempt 1")).toBeVisible();
  await expect.element(screen.getByText("Selected model at capacity")).toBeVisible();
  await act(() => vi.advanceTimersByTimeAsync(3000));
  await expect.element(screen.getByText("Retrying in 2s · attempt 1")).toBeVisible();
  await act(() => vi.advanceTimersByTimeAsync(2000));
  await expect.element(screen.getByText("Retrying now · attempt 1")).toBeVisible();
  await screen.rerender(
    <ProviderRetryStatus
      item={{
        ...item,
        updatedAt: DateTime.makeUnsafe(6000),
        retry: { ...item.retry, attempt: 2, retryDelayMs: 10000 },
      }}
    />,
  );
  await expect.element(screen.getByText("Retrying in 10s · attempt 2")).toBeVisible();
});
