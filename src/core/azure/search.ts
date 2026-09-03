import type { WorkItem } from "./types.js";

/**
 * Everything matching is offered and the list scrolls, rather than being cut to a handful.
 *
 * A truncated list is fine when it is a shortcut to something you already know the name of,
 * and wrong when it is the only way to browse what is assigned to you — which is what the
 * down arrow is for. The client already caps the whole list at 200.
 */
export const WORK_ITEM_SUGGESTIONS = Number.POSITIVE_INFINITY;

/**
 * Work items matching what has been typed, best first.
 *
 * Runs in the renderer on every keystroke, the same way `buildPicker` does for categories —
 * the list is already on the Snapshot, so filtering is local and costs no IPC round trip.
 *
 * An id typed on its own is the common case ("1234"), so a leading id match outranks a
 * title match. Beyond that it is a plain case-insensitive substring: work item titles are
 * short and fuzzy matching would put surprising things at the top of a list someone is
 * about to press Enter on.
 */
export function searchWorkItems(
  items: readonly WorkItem[],
  query: string,
  limit: number = WORK_ITEM_SUGGESTIONS,
): WorkItem[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return items.slice(0, limit);

  const scored: Array<{ item: WorkItem; rank: number }> = [];
  for (const item of items) {
    const id = String(item.id);
    const title = item.title.toLowerCase();

    // 0: the id starts with what was typed — "12" finds 1234 before it finds a title
    //    containing "12". 1: the title starts with it. 2: it appears anywhere.
    let rank: number;
    if (id.startsWith(trimmed)) rank = 0;
    else if (title.startsWith(trimmed)) rank = 1;
    else if (title.includes(trimmed) || id.includes(trimmed)) rank = 2;
    else continue;

    scored.push({ item, rank });
  }

  // Stable within a rank, so the server's "most recently changed first" order survives.
  return scored
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => (a.rank === b.rank ? a.index - b.index : a.rank - b.rank))
    .slice(0, limit)
    .map((entry) => entry.item);
}
