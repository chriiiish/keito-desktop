import type { KeitoClient } from "../keito/client.js";
import type { Pair, Task } from "../keito/types.js";
import { buildCatalog } from "./catalog.js";
import { RECENTS_WINDOW_DAYS, rankRecents } from "./ranking.js";

export interface Workspace {
  catalog: Pair[];
  /** Pair ids, most relevant first. */
  recents: string[];
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Everything the picker needs, straight from Keito. Recents are derived from entries the
 * server already holds, so they stay correct across the web app and other machines.
 */
export async function loadWorkspace(client: KeitoClient, now: Date): Promise<Workspace> {
  const projects = await client.listProjects();

  const tasksByProjectId: Record<string, Task[]> = {};
  await Promise.all(
    projects.map(async (project) => {
      tasksByProjectId[project.id] = await client.listTasks(project.id);
    }),
  );

  const since = new Date(now.getTime() - RECENTS_WINDOW_DAYS * 86_400_000);
  const entries = await client.listTimeEntries({ from: isoDate(since), to: isoDate(now) });

  return { catalog: buildCatalog(projects, tasksByProjectId), recents: rankRecents(entries, now) };
}
