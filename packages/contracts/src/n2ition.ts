import * as Schema from "effect/Schema";

export const N2ITION_MAX_TASKS = 5_000;
export const N2ITION_MAX_BYTES = 2 * 1024 * 1024;
export const N2ITION_CONTEXT_MAX_BYTES = 64 * 1024;
export const N2ITION_TIMEZONE = "America/Chicago" as const;

function isDateTime(value: string, utcOnly: boolean): boolean {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/,
  );
  if (!match || (utcOnly && match[7] !== "Z") || !Number.isFinite(Date.parse(value))) return false;
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    ,
    offsetHour,
    offsetMinute,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= monthDays[month - 1]! &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    (offsetHour === undefined || (Number(offsetHour) <= 23 && Number(offsetMinute) <= 59))
  );
}

const DateTimeWithOffset = Schema.String.check(
  Schema.makeFilter((value) => isDateTime(value, false)),
);
const UtcDateTime = Schema.String.check(Schema.makeFilter((value) => isDateTime(value, true)));
const NullableDateTimeWithOffset = Schema.NullOr(DateTimeWithOffset);
const NullableBoundedString = (maxLength: number) =>
  Schema.NullOr(Schema.String.check(Schema.isMaxLength(maxLength)));

export const N2itionTask = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  title: Schema.String.check(Schema.isMaxLength(4_096)),
  notes: NullableBoundedString(65_536),
  priority: Schema.Literals(["low", "medium", "high", "urgent"]),
  status: Schema.Literals(["pending", "in_progress", "completed", "snoozed"]),
  dueDate: NullableDateTimeWithOffset,
  timeBand: Schema.NullOr(
    Schema.Literals(["morning", "midday", "afternoon", "evening", "anytime"]),
  ),
  domain: NullableBoundedString(256),
  sortOrder: Schema.NullOr(Schema.Finite),
  snoozedUntil: NullableDateTimeWithOffset,
  completedAt: NullableDateTimeWithOffset,
  createdAt: DateTimeWithOffset,
  contextType: Schema.Literals(["none", "contact", "self"]),
  recurrenceSeriesId: NullableBoundedString(128),
  recurrenceInstanceDueDate: NullableDateTimeWithOffset,
  recurrenceSequence: Schema.NullOr(Schema.Int),
});
export type N2itionTask = typeof N2itionTask.Type;

const N2itionTaskRows = Schema.Array(N2itionTask).check(
  Schema.isMaxLength(N2ITION_MAX_TASKS),
  Schema.makeFilter((tasks) => new Set(tasks.map(({ id }) => id)).size === tasks.length),
);

export const N2itionSnapshot = Schema.Struct({
  version: Schema.Literal(1),
  source: Schema.Literals(["synthetic", "live"]),
  generatedAt: UtcDateTime,
  expiresAt: UtcDateTime,
  digest: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  epoch: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  complete: Schema.Literal(true),
  timezone: Schema.Literal(N2ITION_TIMEZONE),
  tasks: N2itionTaskRows,
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type N2itionSnapshot = typeof N2itionSnapshot.Type;

const decodeSnapshot = Schema.decodeUnknownSync(N2itionSnapshot, { onExcessProperty: "error" });

/** Decode the bounded JSON wire payload and reject unknown properties at every level. */
export function decodeN2itionSnapshot(input: unknown): N2itionSnapshot {
  let json: string | undefined;
  try {
    json = JSON.stringify(input);
  } catch {
    throw new TypeError("N2ition snapshot must be JSON serializable");
  }
  if (json === undefined || new TextEncoder().encode(json).byteLength > N2ITION_MAX_BYTES) {
    throw new RangeError("N2ition snapshot exceeds the 2 MiB wire limit");
  }
  return decodeSnapshot(input);
}
