import { useEffect, useState } from "react";
import { formatTrayLabel, type TrayFallback, type TrayPrefix } from "../core/tray/label.js";
import type { Snapshot } from "../../electron/service.js";
import { keito } from "./keito-api.js";

/** Stand-in used for the preview when no timer is running. */
const SAMPLE = { note: "Sprint planning", projectName: "Acme Rebuild", taskName: "Development" };
/** 1:23, for the elapsed-time example — long enough to look like a real stretch of work. */
const SAMPLE_ELAPSED_SECONDS = 83 * 60;

const PREFIX_OPTIONS: ReadonlyArray<readonly [TrayPrefix, string]> = [
  ["none", "Just the note"],
  ["project", "Project, then the note"],
  ["task", "Task, then the note"],
];

const FALLBACK_OPTIONS: ReadonlyArray<readonly [TrayFallback, string]> = [
  ["task", "Show the task"],
  ["project", "Show the project"],
];

/**
 * The tray label has two settings whose effect is hard to picture from their names, so
 * every option carries the text it would actually produce, and the preview above updates
 * as soon as one is chosen rather than waiting for the write to come back.
 */
export function TrayLabelSettings({
  snapshot,
  onChange,
}: {
  snapshot: Snapshot;
  onChange: (next: Snapshot) => void;
}): JSX.Element {
  const [prefix, setPrefix] = useState<TrayPrefix>(snapshot.trayPrefix);
  const [fallback, setFallback] = useState<TrayFallback>(snapshot.trayFallback);
  const [showElapsed, setShowElapsed] = useState(snapshot.trayShowElapsed);

  useEffect(() => setPrefix(snapshot.trayPrefix), [snapshot.trayPrefix]);
  useEffect(() => setFallback(snapshot.trayFallback), [snapshot.trayFallback]);
  useEffect(() => setShowElapsed(snapshot.trayShowElapsed), [snapshot.trayShowElapsed]);

  // macOS draws the label beside the menu bar icon. Windows has no equivalent, so the
  // same text leads the tray tooltip instead — same setting, different place to look.
  const inTooltip = snapshot.platform !== "darwin";

  const running = snapshot.timer.status === "running" ? snapshot.timer : null;
  const subject = running
    ? {
        note: running.note,
        projectName: running.pair.projectName,
        taskName: running.pair.taskName,
        elapsedSeconds: Math.max(0, Math.floor((Date.now() - running.startedAtMs) / 1000)),
      }
    : { ...SAMPLE, elapsedSeconds: SAMPLE_ELAPSED_SECONDS };

  const apply = (next: { prefix: TrayPrefix; fallback: TrayFallback; showElapsed: boolean }) => {
    setPrefix(next.prefix);
    setFallback(next.fallback);
    setShowElapsed(next.showElapsed);
    void keito.setTrayLabel(next).then(onChange);
  };

  return (
    <div className="tray-label">
      <div className="tray-preview">
        <span className="tray-preview-icon" aria-hidden="true">
          ◷
        </span>
        <span className="tray-preview-text" data-testid="tray-preview">
          {formatTrayLabel(subject, { fallback, prefix, showElapsed })}
        </span>
        <span className="tray-preview-caption">
          {running ? "your running timer" : "example"}
          {inTooltip ? " · shown in the tray tooltip" : ""}
        </span>
      </div>

      <fieldset className="tray-choice">
        <legend>When there is a note</legend>
        {PREFIX_OPTIONS.map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name="tray-prefix"
              value={value}
              checked={prefix === value}
              onChange={() => apply({ prefix: value, fallback, showElapsed })}
            />
            <span className="tray-choice-label">{label}</span>
            <span className="tray-choice-example">
              {formatTrayLabel(
                { ...subject, note: subject.note || SAMPLE.note },
                { fallback, prefix: value, showElapsed },
              )}
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="tray-choice">
        <legend>When the note is blank</legend>
        {FALLBACK_OPTIONS.map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name="tray-fallback"
              value={value}
              checked={fallback === value}
              onChange={() => apply({ prefix, fallback: value, showElapsed })}
            />
            <span className="tray-choice-label">{label}</span>
            <span className="tray-choice-example">
              {formatTrayLabel({ ...subject, note: null }, { fallback: value, prefix, showElapsed })}
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="tray-choice">
        <legend>Elapsed time</legend>
        <label>
          <input
            type="checkbox"
            checked={showElapsed}
            onChange={(event) => apply({ prefix, fallback, showElapsed: event.target.checked })}
          />
          <span className="tray-choice-label">Also show how long the timer has been running</span>
          <span className="tray-choice-example">
            {formatTrayLabel(subject, { fallback, prefix, showElapsed: true })}
          </span>
        </label>
      </fieldset>
    </div>
  );
}
