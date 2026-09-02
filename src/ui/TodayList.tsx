import type { Pair, TimeEntry } from "../core/keito/types.js";
import { AsyncButton } from "./AsyncButton.js";

interface TodayListProps {
  entries: readonly TimeEntry[];
  catalog: readonly Pair[];
  onResume: (entryId: string) => Promise<unknown>;
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
 * What you have already worked on today, each resumable in one click. Resuming continues
 * the existing entry rather than creating a second one for the same task.
 */
export function TodayList({ entries, catalog, onResume, onStop }: TodayListProps): JSX.Element {
  const named = entries.map((entry) => {
    const pair = catalog.find(
      (candidate) => candidate.projectId === entry.project_id && candidate.taskId === entry.task_id,
    );
    return {
      entry,
      taskName: pair?.taskName ?? "Unknown task",
      projectName: pair?.projectName ?? "Unknown project",
    };
  });

  return (
    <section className="today">
      <div className="today-heading">Today</div>
      {named.length === 0 ? (
        <p className="empty">Nothing logged yet today.</p>
      ) : (
        <ul>
          {named.map(({ entry, taskName, projectName }) => (
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
}
