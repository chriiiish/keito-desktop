import type { TimeEntry } from "./types.js";

/** Which of a time entry's two notes a typed note is meant to be. */
export type NoteVisibility = "client" | "internal";

/** The note fields of an entry, as the API names them. */
export interface EntryNotes {
  notes: string | null | undefined;
  internal_notes?: string | null | undefined;
}

/**
 * The note to show for an entry: the client-visible one, or the internal one when there
 * isn't one.
 *
 * One rule everywhere — the menu bar label, today and yesterday, and the entries table —
 * so the same entry never reads differently depending on where you are looking at it.
 *
 * "Has a value" means has a value after trimming. A note of `"   "` is not a note, and
 * falling back on it would show an entry as blank while an internal note sat behind it.
 */
export function visibleNote(entry: EntryNotes): string {
  return entry.notes?.trim() || entry.internal_notes?.trim() || "";
}

/**
 * Which field the shown note came from.
 *
 * The entries table edits what it displays, so it has to write back to the field it read
 * from — otherwise correcting a fallback internal note would quietly publish it to the
 * client by saving it as `notes`.
 *
 * An entry with neither note is "client", because that is what typing into an untouched
 * row is meant to produce by default.
 */
export function visibleNoteField(entry: EntryNotes): NoteVisibility {
  return entry.notes?.trim() ? "client" : entry.internal_notes?.trim() ? "internal" : "client";
}

/** The typed note as the field the toggle says it is, ready to send. */
export function noteFor(
  visibility: NoteVisibility,
  note: string | undefined,
): { notes?: string; internalNotes?: string } {
  const trimmed = note?.trim();
  if (!trimmed) return {};
  return visibility === "internal" ? { internalNotes: trimmed } : { notes: trimmed };
}

/** Convenience for callers holding a whole entry. */
export function entryVisibleNote(entry: Pick<TimeEntry, "notes" | "internal_notes">): string {
  return visibleNote(entry);
}
