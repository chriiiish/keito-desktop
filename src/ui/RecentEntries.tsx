import type { Pair, TimeEntry } from "../core/keito/types.js";
import { AsyncButton } from "./AsyncButton.js";

interface RecentEntriesProps {
  today: readonly TimeEntry[];
  yesterday: readonly TimeEntry[];
  catalog: readonly Pair[];
  /** Continues an entry from today, on Keito's restart endpoint. */
  onResume: (entryId: string) => Promise<unknown>;
  /** Starts a fresh entry today from an older one's category and note. */
  onStartAgain: (pairId: string, notes: string | undefined) => Promise<unknown>;
  onStop: () => Promise<unknown>;
}

/** Decimal hours as h:mm, which is how you actually read a timesheet. */
function formatHours(entry: TimeEntry): string {
  const seconds =
    entry.duration_seconds ?? Math.round((entry.hours ?? 0) * 3600);
  const minutes = Math.max(0, Math.round(seconds / 60));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
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
  onResume,
  onStartAgain,
  onStop,
}: RecentEntriesProps): JSX.Element {
  const describe = (entry: TimeEntry) => {
    const pair = catalog.find(
      (candidate) => candidate.projectId === entry.project_id && candidate.taskId === entry.task_id,
    );
    return {
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
    <section className="today">
      <div className="today-heading">{heading}</div>
      {entries.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <ul>
          {entries.map(describe).map(({ entry, pair, taskName, projectName }) => (
            <li key={entry.id} className={entry.is_running ? "running-row" : ""}>
              <div className="today-text">
                <strong>{entry.notes?.trim() || taskName}</strong>
                <span>
                  {projectName} — {taskName}
                </span>
              </div>
              <span className="today-hours">{formatHours(entry)}</span>
              {entry.is_running ? (
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
                  className="play small"
                  title="Start this again today"
                  aria-label={`Start ${taskName} again today`}
                  // An entry whose project or task has since been archived resolves to no
                  // pair, and there is nothing to start it against.
                  disabled={!pair}
                  onClick={() => onStartAgain(pair!.id, entry.notes?.trim() || undefined)}
                >
                  ▶
                </AsyncButton>
              ) : (
                <AsyncButton
                  className="play small"
                  title="Resume this entry"
                  aria-label={`Resume ${taskName}`}
                  onClick={() => onResume(entry.id)}
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
    <>
      {day("Today", today, "Nothing logged yet today.", false)}
      {/* Left out entirely on a day with no history behind it, rather than showing an
          empty heading that says nothing. */}
      {yesterday.length > 0 && day("Yesterday", yesterday, "", true)}
    </>
  );
}
