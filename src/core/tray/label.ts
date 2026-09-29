import { formatDuration } from "../time/elapsed.js";

/** Longest tray label, including the ellipsis. The menu bar has little room. */
export const TRAY_LABEL_MAX = 40;

/** What to show when the running entry has no note. */
export type TrayFallback = "task" | "project";

/** What, if anything, to put in front of a note. */
export type TrayPrefix = "none" | "project" | "task";

export interface TrayLabelOptions {
  fallback: TrayFallback;
  prefix: TrayPrefix;
  /** Appends this running entry's own elapsed time to the end of the label. */
  showElapsed: boolean;
}

export interface TrayLabelInput {
  note: string | null | undefined;
  projectName: string;
  taskName: string;
  /**
   * How long the running entry itself has been going, in seconds — not the day's
   * cumulative total on the task, which is a popover-only concept. Null or undefined
   * when nothing is running, or the start time is unknown.
   */
  elapsedSeconds?: number | null;
}

/**
 * The text shown beside the tray icon. The note is the point — it's what actually says
 * what you're doing — so it leads, with the project or task available as a prefix for
 * context, and as a fallback when there is no note.
 *
 * Elapsed time, when shown, always survives truncation in full: it is the one thing this
 * label cannot silently drop, so the message shrinks around it rather than the other way
 * round.
 */
export function formatTrayLabel(
  { note, projectName, taskName, elapsedSeconds }: TrayLabelInput,
  { fallback, prefix, showElapsed }: TrayLabelOptions,
): string {
  const cleaned = (note ?? "").replace(/\s+/g, " ").trim();
  const fallbackText = fallback === "project" ? projectName : taskName;

  // Prefixing with the same thing the label already is would just repeat it.
  const prefixText = prefix === "project" ? projectName : prefix === "task" ? taskName : "";
  const message = cleaned ? (prefixText ? `${prefixText}: ${cleaned}` : cleaned) : fallbackText;

  const time = showElapsed && elapsedSeconds != null ? formatDuration(elapsedSeconds) : null;
  return time ? withElapsed(message, time) : truncate(message);
}

function truncate(text: string): string {
  return text.length <= TRAY_LABEL_MAX ? text : `${text.slice(0, TRAY_LABEL_MAX - 1)}…`;
}

function withElapsed(message: string, time: string): string {
  const suffix = ` ${time}`;
  const full = `${message}${suffix}`;
  if (full.length <= TRAY_LABEL_MAX) return full;

  const budget = Math.max(0, TRAY_LABEL_MAX - suffix.length - 1); // 1 for the ellipsis
  return `${message.slice(0, budget)}…${suffix}`;
}
