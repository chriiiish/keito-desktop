import type { Pair } from "../keito/types.js";

export type PickerSectionName = "favourites" | "recent" | "all";

export interface PickerSection {
  section: PickerSectionName;
  pairs: Pair[];
}

export interface BuildPickerInput {
  catalog: readonly Pair[];
  /** Pair ids, in the order the user arranged them. */
  favourites: readonly string[];
  /** Pair ids, most relevant first, from rankRecents. */
  recents: readonly string[];
  query: string;
}

/**
 * The exact list the popover renders: favourites, then recently used, then the rest of the
 * workspace. A pair appears in one section only — the highest it qualifies for.
 */
export function buildPicker({ catalog, favourites, recents, query }: BuildPickerInput): PickerSection[] {
  const byId = new Map(catalog.map((pair) => [pair.id, pair]));
  const claimed = new Set<string>();

  const take = (ids: readonly string[]): Pair[] => {
    const pairs: Pair[] = [];
    for (const id of ids) {
      const pair = byId.get(id);
      // Skip ids that no longer resolve: archived projects, unassigned tasks.
      if (!pair || claimed.has(id)) continue;
      claimed.add(id);
      pairs.push(pair);
    }
    return pairs;
  };

  const sections: PickerSection[] = [
    { section: "favourites", pairs: take(favourites) },
    { section: "recent", pairs: take(recents) },
    { section: "all", pairs: catalog.filter((pair) => !claimed.has(pair.id)) },
  ];

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (pair: Pair) => {
    const haystack = `${pair.projectName} ${pair.taskName} ${pair.clientName ?? ""}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  };

  return sections
    .map((s) => ({ section: s.section, pairs: s.pairs.filter(matches) }))
    .filter((s) => s.pairs.length > 0);
}
