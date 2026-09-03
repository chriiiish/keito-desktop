import type { TimeEntry } from "../keito/types.js";
import { entrySeconds } from "./elapsed.js";

/**
 * A day's entries folded into one row per thing actually worked on.
 *
 * Keito has no notion of "the same work continued". Switching away and back is
 * `POST /time_entries` with `replace_running`, which creates a **new** entry every time,
 * so an hour spent on one task in three sittings is three rows. Worse, a running entry
 * reports `hours: null` — its length is only measurable from `timer_started_at` — so while
 * the third sitting was going the popover showed only that sitting, and the first two had
 * apparently never happened.
 *
 * Grouping by (project, task, note) is what puts the day back together. It is also what
 * `RecentEntries` already claimed to do: "the day keeps one row per task" was true of
 * resuming, which restarts the entry in place, and quietly untrue of switching.
 */

/** One task-and-note worked on during a day, however many entries it took. */
export interface EntryTotal {
  /** `projectId:taskId:note` — the identity of the work, not of any one entry. */
  key: string;
  /**
   * The newest entry in the group. The row's buttons act on this one: resuming has to
   * restart the most recent stretch, not the first of the day.
   */
  latest: TimeEntry;
  /** Every entry in the group, newest first. */
  entries: TimeEntry[];
  /** Whether the work is going right now. */
  isRunning: boolean;
  /**
   * Total across the group in seconds, or null when not one entry in it could be
   * measured — so an unknown length still reads as "—" rather than a confident 0:00.
   */
  seconds: number | null;
}

/**
 * A note reduced to what makes two of them the same note.
 *
 * Keito stores an untouched note as `null` and a cleared one as `""`, and someone who
 * typed neither means the same by both. Trimmed, because trailing whitespace is not a
 * different piece of work.
 */
function noteKey(notes: string | null | undefined): string {
  return notes?.trim() ?? "";
}

/**
 * Entries grouped by the work they represent, each with its total.
 *
 * Order follows the input — which is newest first — by the newest entry in each group, so
 * a day still reads top-down in the order things last happened.
 */
export function totalsByTaskAndNote(
  entries: readonly TimeEntry[],
  nowMs: number,
  timeZone: string,
): EntryTotal[] {
  const groups = new Map<string, EntryTotal>();

  for (const entry of entries) {
    const key = `${entry.project_id}:${entry.task_id}:${noteKey(entry.notes)}`;
    const seconds = entrySeconds(entry, nowMs, timeZone);
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        key,
        latest: entry,
        entries: [entry],
        isRunning: entry.is_running,
        seconds,
      });
      continue;
    }

    existing.entries.push(entry);
    existing.isRunning ||= entry.is_running;
    // null is "not measurable", not zero: it must not drag a real total down, but a group
    // of nothing but unmeasurable entries stays null rather than becoming 0.
    if (seconds !== null) existing.seconds = (existing.seconds ?? 0) + seconds;
  }

  return [...groups.values()];
}

/**
 * Seconds already logged today against whatever is running, not counting the running
 * stretch itself.
 *
 * The header clock ticks locally from the running entry's start, so it can only show the
 * whole day's work on that task if it is told what came before. Without this the header
 * and the row for the very same task show two different numbers, both ticking, in a window
 * small enough to see them side by side.
 *
 * Excludes every running entry rather than just the one found, so a workspace that somehow
 * has two going cannot double-count against a clock that is already ticking one of them.
 */
export function loggedBeforeRunning(entries: readonly TimeEntry[], timeZone: string): number {
  const current = entries.find((entry) => entry.is_running);
  if (!current) return 0;

  const key = `${current.project_id}:${current.task_id}:${noteKey(current.notes)}`;
  let total = 0;
  for (const entry of entries) {
    if (entry.is_running) continue;
    if (`${entry.project_id}:${entry.task_id}:${noteKey(entry.notes)}` !== key) continue;
    // `nowMs` is irrelevant for a stopped entry — its length comes from hours or
    // duration_seconds — so any instant does, and 0 says so.
    total += entrySeconds(entry, 0, timeZone) ?? 0;
  }
  return total;
}
