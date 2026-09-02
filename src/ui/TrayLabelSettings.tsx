import { useEffect, useState } from "react";
import { formatTrayLabel, type TrayFallback, type TrayPrefix } from "../core/tray/label.js";
import type { Snapshot } from "../../electron/service.js";
import { keito } from "./keito-api.js";

/** Stand-in used for the preview when no timer is running. */
const SAMPLE = { note: "Sprint planning", projectName: "Acme Rebuild", taskName: "Development" };

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
 * The menu bar label has two settings whose effect is hard to picture from their names, so
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

  useEffect(() => setPrefix(snapshot.trayPrefix), [snapshot.trayPrefix]);
  useEffect(() => setFallback(snapshot.trayFallback), [snapshot.trayFallback]);

  const running = snapshot.timer.status === "running" ? snapshot.timer : null;
  const subject = running
    ? { note: running.note, projectName: running.pair.projectName, taskName: running.pair.taskName }
    : SAMPLE;

  const apply = (next: { prefix: TrayPrefix; fallback: TrayFallback }) => {
    setPrefix(next.prefix);
    setFallback(next.fallback);
    void keito.setTrayLabel(next).then(onChange);
  };

  return (
    <div className="tray-label">
      <div className="tray-preview">
        <span className="tray-preview-icon" aria-hidden="true">
          ◷
        </span>
        <span className="tray-preview-text" data-testid="tray-preview">{formatTrayLabel(subject, { fallback, prefix })}</span>
        <span className="tray-preview-caption">
          {running ? "your running timer" : "example"}
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
              onChange={() => apply({ prefix: value, fallback })}
            />
            <span className="tray-choice-label">{label}</span>
            <span className="tray-choice-example">
              {formatTrayLabel({ ...subject, note: subject.note || SAMPLE.note }, { fallback, prefix: value })}
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
              onChange={() => apply({ prefix, fallback: value })}
            />
            <span className="tray-choice-label">{label}</span>
            <span className="tray-choice-example">
              {formatTrayLabel({ ...subject, note: null }, { fallback: value, prefix })}
            </span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}
