/**
 * Keito exchanges times as `HH:mm` strings in the *workspace* timezone, not ISO instants.
 * The switching path avoids this entirely — the server sets started_time and ended_time —
 * so these helpers exist only for manual corrections in the window.
 */

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

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
