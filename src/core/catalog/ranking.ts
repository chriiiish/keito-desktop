import { pairId } from "./catalog.js";

/** How far back we look for "previously used" pairs. */
export const RECENTS_WINDOW_DAYS = 30;

/** Days after which a use counts for half as much. Keeps last month from crowding out this week. */
const HALF_LIFE_DAYS = 7;

const MS_PER_DAY = 86_400_000;

export interface RankableEntry {
  project_id: string;
  task_id: string;
  /** YYYY-MM-DD, per the Keito API. */
  spent_date: string;
}

/**
 * Orders previously-used pairs by how much you're likely to want them next: uses within
 * the window, each decayed by age. Most relevant first.
 */
export function rankRecents(entries: readonly RankableEntry[], now: Date): string[] {
  const scores = new Map<string, number>();

  for (const entry of entries) {
    const daysAgo = Math.floor((now.getTime() - Date.parse(`${entry.spent_date}T00:00:00Z`)) / MS_PER_DAY);
    if (daysAgo < 0 || daysAgo > RECENTS_WINDOW_DAYS) continue;

    const id = pairId(entry.project_id, entry.task_id);
    scores.set(id, (scores.get(id) ?? 0) + 0.5 ** (daysAgo / HALF_LIFE_DAYS));
  }

  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
