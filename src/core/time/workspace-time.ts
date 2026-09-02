/**
 * Keito exchanges times as `HH:mm` strings in the *workspace* timezone, not ISO instants.
 * The switching path avoids this entirely — the server sets started_time and ended_time —
 * so these helpers exist only for manual corrections in the window.
 */

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * The calendar date at `instant` **in the workspace's timezone**, as the YYYY-MM-DD
 * Keito's `spent_date` expects.
 *
 * Not `toISOString().slice(0, 10)`: that is the date in UTC, which is the wrong day for
 * most of the world for part of every day. A timer started at 08:00 in Sydney would be
 * logged against yesterday; one started at 18:00 in California, against tomorrow.
 */
export function workspaceDate(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the wire format.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Whole days between two YYYY-MM-DD dates. Both are already workspace-local. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** `days` before the given YYYY-MM-DD date, as another YYYY-MM-DD. */
export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function formatWorkspaceTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}

export function parseWorkspaceTime(spentDate: string, time: string, timeZone: string): Date {
  const match = HH_MM.exec(time);
  if (!match) throw new RangeError(`Expected a HH:mm time, got "${time}".`);

  // Start from the naive wall-clock instant, then correct by the zone's offset at that
  // moment. Applied twice so a DST boundary within the correction still lands correctly.
  const naive = Date.parse(`${spentDate}T${time}:00Z`);
  let guess = naive;
  for (let i = 0; i < 2; i++) {
    guess = naive - zoneOffsetMs(new Date(guess), timeZone);
  }
  return new Date(guess);
}

/** How far ahead of UTC `timeZone` is at `instant`, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - instant.getTime();
}
