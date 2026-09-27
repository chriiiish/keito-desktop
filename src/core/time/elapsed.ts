import type { TimeEntry } from "../keito/types.js";
import { parseWorkspaceTime } from "./workspace-time.js";

/**
 * When an entry's timer began, in epoch ms.
 *
 * The live API supplies `timer_started_at` as a real instant; reconstructing a start from
 * `spent_date` plus the `HH:mm` wall-clock string is only a fallback for entries without
 * one, and needs the workspace zone to mean anything.
 *
 * Returns null when neither is usable, so callers decide what an unknown start means
 * rather than being handed a plausible-looking `Date.now()`.
 */
export function entryStartMs(
  entry: Pick<TimeEntry, "timer_started_at" | "started_time" | "spent_date">,
  timeZone: string,
): number | null {
  if (entry.timer_started_at) {
    const parsed = Date.parse(entry.timer_started_at);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (entry.started_time) {
    try {
      return parseWorkspaceTime(entry.spent_date, entry.started_time, timeZone).getTime();
    } catch {
      // An unparseable time is no start at all.
    }
  }
  return null;
}

/**
 * How long an entry represents, in seconds.
 *
 * A **running** entry reports `hours: null` — verified against the live API and mirrored
 * by the fake — so formatting `hours` for one yields zero, which is why a running timer
 * used to read `0:00` in the lists. Its length is the current stretch, measured from its
 * start, plus whatever the entry already carries from before that stretch began.
 *
 * The second part matters for a resumed entry. `PATCH /time_entries/:id/restart`
 * continues the entry it is given rather than creating a new one, so a task run for
 * thirty minutes, stopped, and resumed for ten is one entry whose `duration_seconds` (or
 * `hours`) still holds the first thirty while `timer_started_at` marks only the second
 * stretch. Reading the current stretch alone made a resumed task's total shrink back to
 * whatever has elapsed since the resume, as if the earlier work had not happened.
 */
export function entrySeconds(
  entry: TimeEntry,
  nowMs: number,
  timeZone: string,
): number | null {
  if (entry.is_running) {
    const startedAt = entryStartMs(entry, timeZone);
    if (startedAt === null) return null;
    const elapsed = Math.max(0, Math.floor((nowMs - startedAt) / 1000));
    const priorSeconds =
      entry.duration_seconds ?? (entry.hours != null ? Math.round(entry.hours * 3600) : 0);
    return elapsed + priorSeconds;
  }
  if (entry.duration_seconds != null) return entry.duration_seconds;
  if (entry.hours != null) return Math.round(entry.hours * 3600);
  return null;
}

/** `h:mm`, which is how a timesheet is actually read. Null for an unknown length. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const minutes = Math.max(0, Math.round(seconds / 60));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Decimal hours to two places, matching the column the entries table already shows. */
export function formatDecimalHours(seconds: number | null): string {
  if (seconds === null) return "—";
  return (seconds / 3600).toFixed(2);
}
