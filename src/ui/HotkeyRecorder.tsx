import { useEffect, useState } from "react";
import { formatAccelerator, toAccelerator } from "../core/keyboard/accelerator.js";

interface HotkeyRecorderProps {
  hotkey: string;
  platform: string;
  registered: boolean;
  onRecord: (accelerator: string) => Promise<unknown>;
}

/**
 * Captures a shortcut by listening for it, rather than asking the user to spell an
 * Electron accelerator into a text box. A typo there produced a string the OS silently
 * refused; pressing the keys cannot.
 */
export function HotkeyRecorder({
  hotkey,
  platform,
  registered,
  onRecord,
}: HotkeyRecorderProps): JSX.Element {
  const [recording, setRecording] = useState(false);
  const [held, setHeld] = useState<string[]>([]);

  const stop = () => {
    setRecording(false);
    setHeld([]);
  };

  useEffect(() => {
    if (!recording) return;

    const onKeyDown = (event: KeyboardEvent) => {
      // While recording the keyboard belongs to us, not to the focused control.
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        stop();
        return;
      }

      const accelerator = toAccelerator(event, platform);
      if (accelerator) {
        stop();
        void onRecord(accelerator);
        return;
      }

      // Only modifiers so far — echo them back so it is obvious we are listening.
      const primary = platform === "darwin" ? event.metaKey : event.ctrlKey;
      setHeld(
        [primary && "CommandOrControl", event.altKey && "Alt", event.shiftKey && "Shift"].filter(
          (part): part is string => typeof part === "string",
        ),
      );
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, platform, onRecord]);

  const parts = recording ? held : hotkey.split("+").filter(Boolean);
  const chips = formatAccelerator(parts.join("+"), platform);

  return (
    <>
      <div className="hotkey">
        <div
          className={`hotkey-display${recording ? " recording" : ""}`}
          aria-live="polite"
          aria-label="Current shortcut"
        >
          {chips.length > 0 ? (
            chips.map((chip, index) => <kbd key={`${chip}-${index}`}>{chip}</kbd>)
          ) : (
            <span className="muted">
              {recording ? "Press a combination…" : "No shortcut set"}
            </span>
          )}
        </div>

        <button type="button" onClick={recording ? stop : () => setRecording(true)}>
          {recording ? "Cancel" : "Record"}
        </button>
      </div>

      {recording && (
        <p className="hint">Hold a modifier and press a key. Escape cancels.</p>
      )}
      {!recording && !registered && (
        <p className="hint warn">
          This shortcut was refused — another application is probably already using it.
          Record a different one.
        </p>
      )}
    </>
  );
}
