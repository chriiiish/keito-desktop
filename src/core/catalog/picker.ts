import type { Pair } from "../keito/types.js";

/** How many recently-used categories to suggest before the full project list. */
export const RECENT_SUGGESTIONS = 3;

export interface ProjectGroup {
  projectId: string;
  projectName: string;
  pairs: Pair[];
}

export interface PickerResult {
  /** Pinned categories, in the order they were favourited. */
  favourites: Pair[];
  /** The most recently used, excluding anything already pinned. */
  recent: Pair[];
  /** Everything, grouped under its project heading. */
  projects: ProjectGroup[];
  /** True when the query matched nothing anywhere. */
  isEmpty: boolean;
}

export interface BuildPickerInput {
  catalog: readonly Pair[];
  /** Pair ids, in the order the user arranged them. */
  favourites: readonly string[];
  /** Pair ids, most relevant first, from rankRecents. */
  recents: readonly string[];
  query: string;
  recentLimit?: number;
}

/**
 * What the category dropdown renders: pinned favourites, a short list of recent
 * categories, then the whole workspace grouped by project.
 *
 * "All projects" deliberately keeps every task, including ones already shown above — it is
 * the place you look when you know the project and want to browse its tasks, and a task
 * silently missing from its own project would be worse than a repeat.
 */
export function buildPicker({
  catalog,
  favourites,
  recents,
  query,
  recentLimit = RECENT_SUGGESTIONS,
}: BuildPickerInput): PickerResult {
  const byId = new Map(catalog.map((pair) => [pair.id, pair]));
  const matches = matcher(query);

  // Ids that no longer resolve — archived projects, unassigned tasks — are dropped.
  const resolve = (ids: readonly string[]) =>
    ids.map((id) => byId.get(id)).filter((pair): pair is Pair => pair !== undefined);

  const pinned = resolve(favourites);
  const pinnedIds = new Set(pinned.map((pair) => pair.id));
  const recent = resolve(recents)
    .filter((pair) => !pinnedIds.has(pair.id))
    .slice(0, recentLimit);

  const groups = new Map<string, ProjectGroup>();
  for (const pair of catalog) {
    if (!matches(pair)) continue;
    let group = groups.get(pair.projectId);
    if (!group) {
      group = { projectId: pair.projectId, projectName: pair.projectName, pairs: [] };
      groups.set(pair.projectId, group);
    }
    group.pairs.push(pair);
  }

  const projects = [...groups.values()].sort((a, b) => a.projectName.localeCompare(b.projectName));
  const filteredFavourites = pinned.filter(matches);
  const filteredRecent = recent.filter(matches);

  return {
    favourites: filteredFavourites,
    recent: filteredRecent,
    projects,
    isEmpty:
      filteredFavourites.length === 0 && filteredRecent.length === 0 && projects.length === 0,
  };
}

/** Every whitespace-separated term must appear somewhere in the project or task name. */
function matcher(query: string): (pair: Pair) => boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return () => true;
  return (pair) => {
    const haystack = `${pair.projectName} ${pair.taskName} ${pair.clientName ?? ""}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  };
}
