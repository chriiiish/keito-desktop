import type { TimeEntry } from "../keito/types.js";
import { entrySeconds, entryStartMs } from "./elapsed.js";
import { visibleNote, visibleNoteField, type EntryNotes } from "../keito/notes.js";

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

/**
 * When a stretch began, as something sortable.
 *
 * A start that cannot be read sorts last rather than first: `-Infinity` puts an entry with
 * neither `timer_started_at` nor `started_time` at the end of its group, where it cannot
 * be mistaken for the most recent one and pull `resume` onto it.
 */
function startedAt(entry: TimeEntry, timeZone: string): number {
  return entryStartMs(entry, timeZone) ?? -Infinity;
}

/** Newest first. Stable, so entries that began at the same moment keep the order given. */
function newestFirst(timeZone: string) {
  return (a: TimeEntry, b: TimeEntry): number => startedAt(b, timeZone) - startedAt(a, timeZone);
}

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
 * What makes two entries the same piece of work, as far as their notes go.
 *
 * Keyed on the note that is **displayed** — the client one, or the internal one behind it
 * — because these rows are what the user sees, and two rows they cannot tell apart is a
 * row that is wrong. Keying on `notes` alone put every internal-only entry in one bucket,
 * since they all have no client note, so two unrelated pieces of work merged into a single
 * row showing one of their notes.
 *
 * The field is part of the key as well as the text. The same words as a client note and as
 * an internal note are two different things: one the client reads and one they do not.
 *
 * Keito stores an untouched note as `null` and a cleared one as `""`, and someone who
 * typed neither means the same by both. Trimmed, because trailing whitespace is not a
 * different piece of work.
 */
function noteKey(entry: EntryNotes): string {
  return `${visibleNoteField(entry)}:${visibleNote(entry)}`;
}

/**
 * Entries grouped by the work they represent, each with its total.
 *
 * **Ordered here rather than trusting the caller.** The list this is handed is whatever
 * `GET /time_entries` paged back: the real API promises no order, and the fake pushes as
 * it creates, so entries arrive *oldest* first. Taking the first entry of a group as its
 * most recent was therefore wrong in the common case — `resume` would restart the first
 * stretch of the day instead of the one you had just been working on.
 *
 * Groups come back newest first by their most recent stretch, so a day reads top-down in
 * the order things last happened however the entries turned up.
 */
export function totalsByTaskAndNote(
  entries: readonly TimeEntry[],
  nowMs: number,
  timeZone: string,
): EntryTotal[] {
  const groups = new Map<string, EntryTotal>();
  // Sorted up front so each group is built newest first and `latest` is simply its head.
  const ordered = [...entries].sort(newestFirst(timeZone));

  for (const entry of ordered) {
    const key = `${entry.project_id}:${entry.task_id}:${noteKey(entry)}`;
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

  // By the newest stretch in each, which is now the head of every group.
  return [...groups.values()].sort((a, b) => newestFirst(timeZone)(a.latest, b.latest));
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

  const key = `${current.project_id}:${current.task_id}:${noteKey(current)}`;
  let total = 0;
  for (const entry of entries) {
    if (entry.is_running) continue;
    if (`${entry.project_id}:${entry.task_id}:${noteKey(entry)}` !== key) continue;
    // `nowMs` is irrelevant for a stopped entry — its length comes from hours or
    // duration_seconds — so any instant does, and 0 says so.
    total += entrySeconds(entry, 0, timeZone) ?? 0;
  }
  return total;
}
