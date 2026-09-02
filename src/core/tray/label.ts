/** Longest tray label, including the ellipsis. The menu bar has little room. */
export const TRAY_LABEL_MAX = 40;

/** What to show when the running entry has no note. */
export type TrayFallback = "task" | "project";

/** What, if anything, to put in front of a note. */
export type TrayPrefix = "none" | "project" | "task";

export interface TrayLabelOptions {
  fallback: TrayFallback;
  prefix: TrayPrefix;
}

export interface TrayLabelInput {
  note: string | null | undefined;
  projectName: string;
  taskName: string;
}

/**
 * The text shown beside the tray icon. The note is the point — it's what actually says
 * what you're doing — so it leads, with the project or task available as a prefix for
 * context, and as a fallback when there is no note.
 */
export function formatTrayLabel(
  { note, projectName, taskName }: TrayLabelInput,
  { fallback, prefix }: TrayLabelOptions,
): string {
  const cleaned = (note ?? "").replace(/\s+/g, " ").trim();
  const fallbackText = fallback === "project" ? projectName : taskName;

  if (!cleaned) return truncate(fallbackText);

  // Prefixing with the same thing the label already is would just repeat it.
  const prefixText = prefix === "project" ? projectName : prefix === "task" ? taskName : "";
  return truncate(prefixText ? `${prefixText}: ${cleaned}` : cleaned);
}

function truncate(text: string): string {
  return text.length <= TRAY_LABEL_MAX ? text : `${text.slice(0, TRAY_LABEL_MAX - 1)}…`;
}
