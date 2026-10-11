import { visibleNote } from "../keito/notes.js";
import type { TimeEntry } from "../keito/types.js";
import { entrySeconds } from "../time/elapsed.js";
import { shiftDate, workspaceDate } from "../time/workspace-time.js";
import { noteWorkItemId } from "./note.js";

/** How far back a ticket's time is counted, today included. */
export const SYNC_WINDOW_DAYS = 14;

export const DEFAULT_SYNC_FIELD = "Microsoft.VSTS.Scheduling.Effort";
export const DEFAULT_HOURS_PER_DAY = 6.2;
export const MIN_HOURS_PER_DAY = 0.5;
export const MAX_HOURS_PER_DAY = 24;

export type SyncUnit = "hours" | "days";

/**
 * The first day of the window, as a YYYY-MM-DD workspace date.
 *
 * Workspace-local like every other `spent_date` comparison, so the window moves with the
 * workspace's midnight rather than UTC's.
 */
export function syncWindowStart(now: Date, timeZone: string): string {
  return shiftDate(workspaceDate(now, timeZone), -(SYNC_WINDOW_DAYS - 1));
}

/**
 * Seconds logged against one work item inside the window.
 *
 * An entry belongs to a ticket when its **visible** note leads with that ticket's id —
 * the same rule the entries table and the popover use, because the note is the only thing
 * tying an entry to a ticket. A running entry counts for its elapsed time so far, which
 * is why the stop-time write includes the stretch that has just ended.
 *
 * Takes whatever entries it is handed and applies the window itself, so a caller holding
 * the 30-day list cannot count more than two weeks by accident.
 */
export function ticketSeconds(
  entries: readonly TimeEntry[],
  workItemId: number,
  now: Date,
  timeZone: string,
): number {
  const from = syncWindowStart(now, timeZone);
  const to = workspaceDate(now, timeZone);
  let total = 0;
  for (const entry of entries) {
    if (entry.spent_date < from || entry.spent_date > to) continue;
    if (noteWorkItemId(visibleNote(entry)) !== workItemId) continue;
    total += entrySeconds(entry, now.getTime(), timeZone) ?? 0;
  }
  return total;
}

/**
 * Where, within one whole hour (or day), a rounded value may land: every tenth, plus the
 * quarter and three-quarter marks. In hundredths so no step is ever a float.
 */
const STEPS = [0, 10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 100];

/**
 * Rounds **up** to the next allowed step: multiples of 0.1, and x.25 / x.75.
 *
 * 1.01 → 1.1, 1.21 → 1.25, 1.26 → 1.3, 1.31 → 1.4. Always up, never nearest, so the
 * ticket never claims less than was logged. The small subtraction absorbs float noise
 * (`0.1 * 3` is not quite 0.3) which would otherwise push an exact value up a step.
 */
export function roundUpEffort(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const hundredths = Math.ceil(value * 100 - 1e-6);
  const whole = Math.floor(hundredths / 100);
  const rest = hundredths - whole * 100;
  const step = STEPS.find((candidate) => candidate >= rest) ?? 100;
  return (whole * 100 + step) / 100;
}

/** The number to write into the field, in the user's unit. */
export function effortValue(
  seconds: number,
  unit: SyncUnit,
  hoursPerDay: number,
): number {
  const hours = seconds / 3600;
  return roundUpEffort(unit === "days" ? hours / hoursPerDay : hours);
}

/** Whether a typed hours-per-day is usable. */
export function isValidHoursPerDay(value: number): boolean {
  return Number.isFinite(value) && value >= MIN_HOURS_PER_DAY && value <= MAX_HOURS_PER_DAY;
}
