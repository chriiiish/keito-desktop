import type { Pair, TimeEntry } from "../core/keito/types.js";
import type { EntryTotal } from "../core/time/totals.js";
import { formatDuration } from "../core/time/elapsed.js";
import { totalsByTaskAndNote } from "../core/time/totals.js";
import { visibleNote, visibleNoteField, type NoteVisibility } from "../core/keito/notes.js";
import { AsyncButton } from "./AsyncButton.js";
import { useNow } from "./useNow.js";

interface RecentEntriesProps {
  today: readonly TimeEntry[];
  yesterday: readonly TimeEntry[];
  catalog: readonly Pair[];
  /** The workspace's zone, for entries whose start is only a wall-clock time. */
  timeZone: string;
  /** Continues an entry from today, on Keito's restart endpoint. */
  onResume: (entryId: string) => Promise<unknown>;
  /** Starts a fresh entry today from an older one's category and note. */
  onStartAgain: (
    pairId: string,
    notes: string | undefined,
    visibility: NoteVisibility,
  ) => Promise<unknown>;
  onStop: () => Promise<unknown>;
}

/**
 * What you have already worked on, today and yesterday, each startable in one click.
 *
 * The two days do **not** share a play button. Resuming today's entry continues it, so
 * the day keeps one row per task. Yesterday's cannot be continued — restarting it would
 * add today's work to yesterday's timesheet — so its button copies the category and note
 * onto a new entry dated today. Same gesture, deliberately different call.
 */
export function RecentEntries({
  today,
  yesterday,
  catalog,
  timeZone,
  onResume,
  onStartAgain,
  onStop,
}: RecentEntriesProps): JSX.Element {
  // A running row is a clock, so it has to move. Every second, so its minute turns over
  // at the same moment as the header's clock rather than up to a minute later, and only
  // while something is actually running — one interval for the list, not one per row.
  const running =
    today.some((entry) => entry.is_running) || yesterday.some((entry) => entry.is_running);
  const now = useNow(1000, running);
  const describe = (total: EntryTotal) => {
    const entry = total.latest;
    const pair = catalog.find(
      (candidate) => candidate.projectId === entry.project_id && candidate.taskId === entry.task_id,
    );
    return {
      total,
      entry,
      pair,
      taskName: pair?.taskName ?? "Unknown task",
      projectName: pair?.projectName ?? "Unknown project",
    };
  };

  const day = (
    heading: string,
    entries: readonly TimeEntry[],
    empty: string,
    startAgain: boolean,
  ) => (
    <section className="day">
      <h2 className="day-heading">{heading}</h2>
      {entries.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <ul>
          {/*
            One row per task-and-note, not per entry. Switching away and back creates a new
            entry each time, so without this a day reads as the same task over and over,
            each row holding a fraction of the time actually spent on it.
          */}
          {totalsByTaskAndNote(entries, now, timeZone)
            .map(describe)
            .map(({ total, entry, pair, taskName, projectName }) => (
            <li key={total.key} className={total.isRunning ? "running-row" : ""}>
              <div className="entry-text">
                <strong>{visibleNote(entry) || taskName}</strong>
                <span>
                  {projectName} — {taskName}
                </span>
              </div>
              <span className={`entry-hours${total.isRunning ? " ticking" : ""}`}>
                {formatDuration(total.seconds)}
              </span>
              {total.isRunning ? (
                <AsyncButton
                  className="stop small"
                  title="Stop this timer"
                  aria-label={`Stop ${taskName}`}
                  onClick={onStop}
                >
                  ■
                </AsyncButton>
              ) : startAgain ? (
                <AsyncButton
                  className="play forward small"
                  title="Start this again today"
                  aria-label={`Start ${taskName} again today`}
                  // An entry whose project or task has since been archived resolves to no
                  // pair, and there is nothing to start it against. Guarded in the handler
                  // as well as by `disabled`, so the two cannot drift apart: the disabled
                  // attribute is a UI affordance, not a guarantee the call is safe.
                  disabled={!pair}
                  onClick={async () => {
                    if (!pair) return;
                    // Carries the note *and* which field it was in, so starting
                    // yesterday's private note again does not publish it today.
                    await onStartAgain(
                      pair.id,
                      visibleNote(entry) || undefined,
                      visibleNoteField(entry),
                    );
                  }}
                >
                  {/* Fast-forward rather than play, because the button does something
                      different: it carries the work forward onto today instead of
                      resuming where it stopped. Two of the ▶ already used elsewhere,
                      closed up by CSS — the single ⏩ codepoint renders as a colour emoji
                      on both macOS and Windows and would not match the other icons. */}
                  ▶▶
                </AsyncButton>
              ) : (
                <AsyncButton
                  className="play small"
                  title="Resume this entry"
                  aria-label={`Resume ${taskName}`}
                  // The newest stretch of this work, so restarting continues where it
                  // actually left off rather than reopening the first entry of the day.
                  onClick={() => onResume(total.latest.id)}
                >
                  ▶
                </AsyncButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    /**
     * One scroller for both days, not one per day.
     *
     * Each section used to carry `flex: 1; overflow-y: auto` of its own, so adding
     * Yesterday split the space in half and gave you two short panes to scroll
     * separately — with a long day today you could not reach yesterday without first
     * scrolling to the bottom of a box that ended halfway up the popover.
     */
    <div className="recent">
      {day("Today", today, "Nothing logged yet today.", false)}
      {/* Left out entirely on a day with no history behind it, rather than showing an
          empty heading that says nothing. */}
      {yesterday.length > 0 && day("Yesterday", yesterday, "", true)}
    </div>
  );
}
