// @effect-diagnostics globalDate:off -- Tests supply fixed calendar instants; no wall-clock timing assertions.
import { describe, expect, it } from "@effect/vitest";
import type { N2itionSnapshot, N2itionTask } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import {
  decodeN2itionContextInput,
  N2itionContextResult,
  selectN2itionContext,
} from "./context.ts";

const decodeResult = Schema.decodeUnknownSync(N2itionContextResult);
const task = (id: string, overrides: Partial<N2itionTask> = {}): N2itionTask => ({
  id,
  title: `Task ${id}`,
  notes: `Private note ${id}`,
  priority: "medium",
  status: "pending",
  dueDate: null,
  timeBand: null,
  domain: null,
  sortOrder: null,
  snoozedUntil: null,
  completedAt: null,
  createdAt: "2026-10-01T12:00:00Z",
  contextType: "none",
  recurrenceSeriesId: null,
  recurrenceInstanceDueDate: null,
  recurrenceSequence: null,
  ...overrides,
});

const snapshot = (tasks: N2itionTask[]): N2itionSnapshot => ({
  version: 1,
  source: "synthetic",
  generatedAt: "2026-10-25T12:00:00Z",
  expiresAt: "2026-10-25T13:00:00Z",
  digest: "a".repeat(64),
  epoch: 0,
  complete: true,
  timezone: "America/Chicago",
  tasks,
});

const select = (
  tasks: N2itionTask[],
  window: "today" | "tomorrow" | "next_seven_days" | "overdue" | "undated" | "all",
  now: string,
  options: { includeNotes?: boolean; offset?: number } = {},
) =>
  selectN2itionContext(
    snapshot(tasks),
    { window, includeNotes: options.includeNotes ?? false, offset: options.offset ?? 0 },
    "https://n2.example",
    new Date(now),
  );

describe("N2ition context selector", () => {
  it("uses Central calendar days across midnight and the spring DST transition", () => {
    const midnight = task("midnight", { dueDate: "2026-03-08T00:00:00-06:00" });
    const lastDay = task("last-day", { dueDate: "2026-03-14T23:59:00-05:00" });
    const outside = task("outside", { dueDate: "2026-03-15T00:00:00-05:00" });
    const beforeLocalMidnight = new Date("2026-03-08T05:30:00Z");
    expect(select([midnight], "today", beforeLocalMidnight.toISOString()).tasks).toHaveLength(0);
    expect(select([midnight], "tomorrow", beforeLocalMidnight.toISOString()).tasks[0]?.dueDay).toBe(
      "2026-03-08",
    );

    const afterLocalMidnight = "2026-03-08T06:30:00Z";
    expect(select([midnight], "today", afterLocalMidnight).tasks[0]?.dueDay).toBe("2026-03-08");
    expect(
      select([lastDay, outside], "next_seven_days", afterLocalMidnight).tasks.map(
        (item) => item.id,
      ),
    ).toEqual(["last-day"]);
  });

  it("orders by priority then manual order and paginates without exposing dueDate or notes", () => {
    const rows = [
      task("medium-first", { priority: "medium", sortOrder: 0 }),
      task("urgent-later", { priority: "urgent", sortOrder: 9 }),
      task("urgent-first", { priority: "urgent", sortOrder: 1 }),
      task("high", { priority: "high", sortOrder: 0 }),
      ...Array.from({ length: 105 }, (_, index) => task(`tail-${String(index).padStart(3, "0")}`)),
    ];
    const first = select(rows, "all", "2026-03-08T06:30:00Z");
    expect(first.tasks.slice(0, 4).map((item) => item.id)).toEqual([
      "urgent-first",
      "urgent-later",
      "high",
      "medium-first",
    ]);
    expect(first.tasks).toHaveLength(100);
    expect(first.truncated).toBe(true);
    expect(first.nextOffset).toBe(100);
    expect(first.tasks[0]).not.toHaveProperty("dueDate");
    expect(first.tasks[0]).not.toHaveProperty("notes");
    expect(first.tasks[0]).not.toHaveProperty("untrustedNotes");
    expect(first.tasks[0]?.link).toBe("https://n2.example/?task=urgent-first");

    const second = select(rows, "all", "2026-03-08T06:30:00Z", { offset: 100 });
    expect(second.tasks).toHaveLength(9);
    expect(second.truncated).toBe(false);
    expect(second.nextOffset).toBeNull();
  });

  it("includes notes only on explicit requests and filters completed and future snoozes in active windows", () => {
    const now = "2026-10-25T15:00:00Z";
    const rows = [
      task("active", { dueDate: "2026-10-25T12:00:00-05:00" }),
      task("snoozed", {
        status: "snoozed",
        dueDate: "2026-10-25T12:00:00-05:00",
        snoozedUntil: "2026-10-26T00:00:00Z",
      }),
      task("completed", { dueDate: "2026-10-25T12:00:00-05:00", status: "completed" }),
      task("future-undated", { status: "snoozed", snoozedUntil: "2026-10-26T00:00:00Z" }),
    ];
    expect(select(rows, "today", now).tasks.map((item) => item.id)).toEqual(["active"]);
    expect(select(rows, "undated", now).tasks).toHaveLength(0);

    const withNotes = select([rows[0]!], "all", now, { includeNotes: true });
    expect(withNotes.tasks[0]?.untrustedNotes).toBe("Private note active");
    expect(withNotes.tasks[0]).not.toHaveProperty("dueDate");
  });

  it("validates the explicit context input and result schemas", () => {
    expect(() =>
      decodeN2itionContextInput({ window: "all", includeNotes: false, offset: 5_001 }),
    ).toThrow();
    expect(() =>
      decodeN2itionContextInput({ window: "all", includeNotes: false, offset: 0, unknown: true }),
    ).toThrow();
    const result = select([task("one")], "all", "2026-10-25T15:00:00Z");
    expect(decodeResult(result)).toEqual(result);
  });
});

it("keeps a pending task visible when it retains an old snooze timestamp", () => {
  expect(
    select(
      [
        task("pending", {
          status: "pending",
          dueDate: "2026-10-25T17:00:00Z",
          snoozedUntil: "2026-10-26T00:00:00Z",
        }),
      ],
      "today",
      "2026-10-25T20:00:00Z",
    ).tasks,
  ).toHaveLength(1);
});
it("caps the entire returned page including notes and metadata", () => {
  const result = select(
    Array.from({ length: 10 }, (_, i) => task(String(i), { notes: "x".repeat(16000) })),
    "all",
    "2026-10-25T20:00:00Z",
    { includeNotes: true },
  );
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(65536);
  expect(result.truncated).toBe(true);
  expect(result.nextOffset).toBeGreaterThan(0);
});

it("returns notes for explicitly selected task IDs", () => {
  const result = selectN2itionContext(
    snapshot([task("first"), task("wanted")]),
    { window: "all", includeNotes: true, offset: 0, taskIds: ["wanted"] },
    "https://n2.example",
    new Date("2026-10-25T20:00:00Z"),
  );
  expect(result.total).toBe(1);
  expect(result.tasks[0]?.id).toBe("wanted");
  expect(result.tasks[0]?.untrustedNotes).toBe("Private note wanted");
});
