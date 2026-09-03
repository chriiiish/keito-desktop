import type { KeitoClient } from "../keito/client.js";
import type { Pair, Project, TimeEntry } from "../keito/types.js";
import { buildCatalog } from "./catalog.js";
import { RECENTS_WINDOW_DAYS, rankRecents } from "./ranking.js";
import { shiftDate, workspaceDate } from "../time/workspace-time.js";
import { entryStartMs } from "../time/elapsed.js";

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

  /**
   * Newest first, which is what `EntriesSnapshot` has always claimed and never did.
   *
   * `GET /time_entries` promises no order and the fake pushes as it creates, so entries
   * arrived *oldest* first — meaning anything reading the head of the list as "the most
   * recent thing" was reading the first of the day. Sorted here, at the one place that
   * builds the lists, rather than in each reader.
   *
   * An entry whose start cannot be read sorts last rather than first, where it cannot be
   * mistaken for the most recent one.
   */
  const newestFirst = (a: TimeEntry, b: TimeEntry): number =>
    (entryStartMs(b, timeZone) ?? -Infinity) - (entryStartMs(a, timeZone) ?? -Infinity);

  const on = (date: string): TimeEntry[] =>
    entries.filter((entry) => entry.spent_date === date).sort(newestFirst);

  return {
    recents: rankRecents(entries, today),
    today: on(today),
    yesterday: on(previous),
    running: entries.find((entry) => entry.is_running) ?? null,
  };
}
