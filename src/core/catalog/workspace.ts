import type { KeitoClient } from "../keito/client.js";
import type { Pair, Task, TimeEntry } from "../keito/types.js";
import { buildCatalog } from "./catalog.js";
import { RECENTS_WINDOW_DAYS, rankRecents } from "./ranking.js";

export interface Workspace {
  catalog: Pair[];
  /** Pair ids, most relevant first. */
  recents: string[];
  /** Today's entries, taken from the same fetch the ranking uses — no extra request. */
  today: TimeEntry[];
}

/** How many task lookups to have in flight at once. Keito throttles a full stampede. */
export const TASK_FETCH_CONCURRENCY = 5;

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/** Runs `work` over `items`, never more than `limit` at a time. */
async function mapWithLimit<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await work(item);
    }
  });
  await Promise.all(runners);
}

/**
 * Everything the picker needs, straight from Keito. Recents are derived from entries the
 * server already holds, so they stay correct across the web app and other machines.
 */
export async function loadWorkspace(
  client: KeitoClient,
  now: Date,
  onProjectError?: (project: { id: string; name: string }, error: unknown) => void,
): Promise<Workspace> {
  const projects = await client.listProjects();

  const tasksByProjectId: Record<string, Task[]> = {};
  await mapWithLimit(projects, TASK_FETCH_CONCURRENCY, async (project) => {
    try {
      tasksByProjectId[project.id] = await client.listTasks(project.id);
    } catch (error) {
      // One project that will not load must not cost you the whole catalog. It simply
      // contributes no pairs; the client has already logged why.
      onProjectError?.(project, error);
    }
  });

  const since = new Date(now.getTime() - RECENTS_WINDOW_DAYS * 86_400_000);
  const entries = await client.listTimeEntries({ from: isoDate(since), to: isoDate(now) });

  const todayDate = isoDate(now);
  return {
    catalog: buildCatalog(projects, tasksByProjectId),
    recents: rankRecents(entries, now),
    today: entries.filter((entry) => entry.spent_date === todayDate),
  };
}
