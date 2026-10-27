import { describe, expect, it } from "@effect/vitest";
import {
  decodeN2itionSnapshot,
  N2ITION_MAX_BYTES,
  N2ITION_MAX_TASKS,
  N2itionSnapshot,
  type N2itionTask,
} from "./n2ition.ts";

const task = (id: string): N2itionTask => ({
  id,
  title: `Task ${id}`,
  notes: null,
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
});

const snapshot = (tasks: N2itionTask[]) => ({
  version: 1 as const,
  source: "synthetic" as const,
  generatedAt: "2026-10-25T12:00:00Z",
  expiresAt: "2026-10-25T13:00:00Z",
  digest: "a".repeat(64),
  epoch: 0,
  complete: true as const,
  timezone: "America/Chicago" as const,
  tasks,
});

describe("N2ition wire contracts", () => {
  it("decodes the N2 field shape and enforces bounded rows, bytes, uniqueness, and timestamps", () => {
    expect(decodeN2itionSnapshot(snapshot([task("one")])).tasks).toHaveLength(1);
    expect(() => decodeN2itionSnapshot(snapshot([task("same"), task("same")]))).toThrow();
    expect(() => decodeN2itionSnapshot({ ...snapshot([task("one")]), extra: true })).toThrow();
    expect(() =>
      decodeN2itionSnapshot({
        ...snapshot([]),
        tasks: [{ ...task("one"), futureField: true }],
      }),
    ).toThrow();
    expect(() =>
      decodeN2itionSnapshot(snapshot([{ ...task("one"), createdAt: "yesterday" }])),
    ).toThrow();
    expect(() =>
      decodeN2itionSnapshot(snapshot([{ ...task("one"), createdAt: "2026-02-30T12:00:00Z" }])),
    ).toThrow();
    expect(() =>
      decodeN2itionSnapshot(
        snapshot(Array.from({ length: N2ITION_MAX_TASKS + 1 }, (_, i) => task(String(i)))),
      ),
    ).toThrow();
    expect(() =>
      decodeN2itionSnapshot({ ...snapshot([]), oversized: "x".repeat(N2ITION_MAX_BYTES) }),
    ).toThrow();
    expect(N2itionSnapshot).toBeDefined();
  });

  it("accepts offset timestamps while preserving their day-level value", () => {
    const row = { ...task("offset"), dueDate: "2026-03-08T00:30:00-06:00" };
    expect(decodeN2itionSnapshot(snapshot([row])).tasks[0]?.dueDate).toBe(row.dueDate);
  });
});
