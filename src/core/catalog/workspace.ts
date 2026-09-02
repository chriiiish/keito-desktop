import type { KeitoClient } from "../keito/client.js";
import type { Pair, Project, TimeEntry } from "../keito/types.js";
import { buildCatalog } from "./catalog.js";
import { RECENTS_WINDOW_DAYS, rankRecents } from "./ranking.js";

export interface EntriesSnapshot {
  /** Pair ids, most relevant first. */
  recents: string[];
  /** Today's entries, newest first. */
  today: TimeEntry[];
  /** The one running entry, if any — no separate request needed to find it. */
  running: TimeEntry | null;
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

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
 */
export async function loadEntries(client: KeitoClient, now: Date): Promise<EntriesSnapshot> {
  const since = new Date(now.getTime() - RECENTS_WINDOW_DAYS * 86_400_000);
  const entries = await client.listTimeEntries({ from: isoDate(since), to: isoDate(now) });

  const today = isoDate(now);
  return {
    recents: rankRecents(entries, now),
    today: entries.filter((entry) => entry.spent_date === today),
    running: entries.find((entry) => entry.is_running) ?? null,
  };
}
