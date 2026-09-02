import { pairId } from "./catalog.js";
import { daysBetween } from "../time/workspace-time.js";

/** How far back we look for "previously used" pairs. */
export const RECENTS_WINDOW_DAYS = 30;

/** Days after which a use counts for half as much. Keeps last month from crowding out this week. */
const HALF_LIFE_DAYS = 7;

export interface RankableEntry {
  project_id: string;
  task_id: string;
  /** YYYY-MM-DD, per the Keito API. */
  spent_date: string;
}

/**
 * Orders previously-used pairs by how much you're likely to want them next: uses within
 * the window, each decayed by age. Most relevant first.
 *
 * `today` is a YYYY-MM-DD date in the **workspace** timezone, the same clock `spent_date`
 * is stamped against — comparing a workspace date against a UTC instant would shift every
 * age by a day for part of each day.
 */
export function rankRecents(entries: readonly RankableEntry[], today: string): string[] {
  const scores = new Map<string, number>();

  for (const entry of entries) {
    const daysAgo = daysBetween(entry.spent_date, today);
    if (daysAgo < 0 || daysAgo > RECENTS_WINDOW_DAYS) continue;

    const id = pairId(entry.project_id, entry.task_id);
    scores.set(id, (scores.get(id) ?? 0) + 0.5 ** (daysAgo / HALF_LIFE_DAYS));
  }

  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
