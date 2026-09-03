import type { WorkItem } from "./types.js";

/**
 * Work items matching what has been typed, **most recently updated first**.
 *
 * Runs in the renderer on every keystroke, the same way `buildPicker` does for categories —
 * the list is already on the Snapshot, so filtering is local and costs no IPC round trip.
 *
 * Matching decides *whether* an item is offered; it deliberately does not decide the order.
 * An earlier version ranked an id match above a title-prefix match above a substring match,
 * which meant typing reshuffled the list into an order nobody could predict: the same
 * tickets, in a different sequence, depending on how many letters you had got through. One
 * rule — the thing you touched most recently is at the top, whether you have typed anything
 * or not — is worth more than a cleverer one nobody can hold in their head.
 *
 * The order is imposed here rather than assumed of the caller. `AzureClient` already sorts,
 * but this is a pure function anything may call, and a property that holds only because
 * today's single caller happens to sort first is not one worth having.
 */
export function searchWorkItems(
  items: readonly WorkItem[],
  query: string,
  limit?: number,
): WorkItem[] {
  const trimmed = query.trim().toLowerCase();

  const matched = trimmed
    ? items.filter((item) => {
        const id = String(item.id);
        return id.includes(trimmed) || item.title.toLowerCase().includes(trimmed);
      })
    : [...items];

  const ordered = matched.sort((a, b) => changedAt(b) - changedAt(a));
  return limit === undefined ? ordered : ordered.slice(0, limit);
}

/**
 * When a work item last changed, as something sortable.
 *
 * A missing or unreadable date is `-Infinity`, so it sorts last. Subtracting `NaN` — which
 * is what `Date.parse(null)` gives — makes every comparison `NaN`, and a comparator
 * returning `NaN` leaves the order untouched rather than putting the undated item anywhere
 * in particular.
 */
function changedAt(item: WorkItem): number {
  const parsed = item.changedDate ? Date.parse(item.changedDate) : NaN;
  return Number.isNaN(parsed) ? -Infinity : parsed;
}
