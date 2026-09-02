import type { KeitoClient } from "../keito/client.js";
import type { Pair, Project, TimeEntry } from "../keito/types.js";
import { buildCatalog } from "./catalog.js";
import { RECENTS_WINDOW_DAYS, rankRecents } from "./ranking.js";
import { shiftDate, workspaceDate } from "../time/workspace-time.js";

export interface EntriesSnapshot {
  /** Pair ids, most relevant first. */
  recents: string[];
  /** Today's entries, newest first. */
  today: TimeEntry[];
  /**
   * Yesterday's, on the same terms. Free: the 30-day window fetched for ranking already
   * contains them, so showing them costs no extra request.
   */
  yesterday: TimeEntry[];
  /** The one running entry, if any — no separate request needed to find it. */
  running: TimeEntry | null;
}

/**
 * The whole category catalog in **one** request: GET /projects embeds each project's
 * assigned tasks, so there is nothing to fetch per project.
 */
export async function loadCatalog(
  client: KeitoClient,
  _now: Date,
  onError?: (error: unknown) => void,
): Promise<Pair[]> {
  let projects: Project[] = [];
  try {
    projects = await client.listProjects();
  } catch (error) {
    // The caller decides whether to keep going with a stale catalog.
    onError?.(error);
    throw error;
  }
  return buildCatalog(projects);
}

/**
 * Recents, today's entries and the running timer from **one** request. The window we
 * already fetch for ranking contains today, and list responses include running entries,
 * so no separate `is_running` lookup is needed.
 *
 * `timeZone` is the workspace's, because `spent_date` is a workspace-local calendar date.
 * Deriving "today" from UTC instead would show yesterday's list all morning east of
 * Greenwich, and tomorrow's all evening west of it.
 */
export async function loadEntries(
  client: KeitoClient,
  now: Date,
  timeZone: string,
): Promise<EntriesSnapshot> {
  const today = workspaceDate(now, timeZone);
  const entries = await client.listTimeEntries({
    from: shiftDate(today, -RECENTS_WINDOW_DAYS),
    to: today,
  });

  // Yesterday by the workspace calendar too, so the boundary moves with `today` rather
  // than sitting a fixed 24 hours behind a UTC clock.
  const previous = shiftDate(today, -1);

  return {
    recents: rankRecents(entries, today),
    today: entries.filter((entry) => entry.spent_date === today),
    yesterday: entries.filter((entry) => entry.spent_date === previous),
    running: entries.find((entry) => entry.is_running) ?? null,
  };
}
