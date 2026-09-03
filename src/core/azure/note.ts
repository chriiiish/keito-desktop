import type { WorkItem } from "./types.js";

/**
 * A work item as the text that goes in a Keito note: `1234: Fix the login redirect`.
 *
 * The note is the **only** carrier. Keito has no custom fields, so nothing structured ties
 * a time entry back to a work item — which is why the id leads, where it stays readable
 * after the tray label truncates the title.
 */
export function workItemNote(item: Pick<WorkItem, "id" | "title">): string {
  const title = item.title.trim();
  return title ? `${item.id}: ${title}` : String(item.id);
}

/** The id a note was written from, or null if it was not written from one. */
export function noteWorkItemId(note: string): number | null {
  const match = /^\s*(\d+):\s/.exec(note);
  return match ? Number(match[1]) : null;
}
