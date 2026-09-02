import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AsyncButton, Spinner, useAsyncAction } from "./AsyncButton.js";
import { CategoryPicker } from "./CategoryPicker.js";
import { Elapsed } from "./Elapsed.js";
import { RecentEntries } from "./RecentEntries.js";
import { keito } from "./keito-api.js";
import { useSnapshot } from "./useSnapshot.js";

export function Popover(): JSX.Element {
  const [snapshot, setSnapshot] = useSnapshot();
  const [selectedId, setSelectedId] = useState("");
  const [note, setNote] = useState("");

  const [idle, setIdle] = useState<{ awaySinceMs: number; awaySeconds: number } | null>(null);
  const noteRef = useRef<HTMLInputElement>(null);

  useEffect(() => keito.onIdleReturn(setIdle), []);

  const running = snapshot?.timer.status === "running" ? snapshot.timer : null;

  // Default to whatever is running, else the first favourite, recent or category.
  const firstSuggestion = useMemo(() => {
    if (!snapshot) return "";
    const resolves = (id: string) => snapshot.catalog.some((pair) => pair.id === id);
    return (
      snapshot.favourites.find(resolves) ?? snapshot.recents.find(resolves) ?? snapshot.catalog[0]?.id ?? ""
    );
  }, [snapshot]);

  useEffect(() => {
    if (selectedId || !snapshot) return;
    setSelectedId(running?.pair.id ?? firstSuggestion);
  }, [snapshot, running, firstSuggestion, selectedId]);

  // The note is the field you actually type in, so it takes focus every time the popover
  // appears — on first mount, and on each show thereafter, since the window is reused.
  const focusNote = useCallback(() => {
    noteRef.current?.focus();
    noteRef.current?.select();
  }, []);

  useEffect(focusNote, [focusNote, snapshot?.keyStatus]);
  useEffect(() => keito.onPopoverShown(focusNote), [focusNote]);

  const [starting, start] = useAsyncAction(async () => {
    if (!selectedId) return;
    const next = await keito.switchTo(selectedId, note.trim() || undefined);
    setSnapshot(next);
    if (!next.error) {
      setNote("");
      void keito.closePopover();
    }
  });

  const resume = async (entryId: string) => {
    const next = await keito.resumeEntry(entryId);
    setSnapshot(next);
    if (!next.error) void keito.closePopover();
  };

  /**
   * Yesterday's rows start a new entry dated today rather than restarting the old one,
   * which would file today's work under yesterday's date.
   */
  const startAgain = async (pairId: string, notes: string | undefined) => {
    const next = await keito.switchTo(pairId, notes);
    setSnapshot(next);
    if (!next.error) void keito.closePopover();
  };

  if (!snapshot) return <div className="popover loading">Loading…</div>;

  if (snapshot.keyStatus !== "ready") {
    // A rejected key is not a first run: someone who set this up once does not need
    // welcoming, they need telling that the key they had has stopped working.
    const rejected = snapshot.keyStatus === "rejected";
    return (
      <div className="popover">
        <div className="onboarding">
          <ClockMark />
          <h1>{rejected ? "Keito needs you again" : "Welcome to Keito Timer"}</h1>
          <p>
            {rejected
              ? "Your API key stopped working, so nothing is being tracked."
              : "Connect your Keito account and start tracking time from the menu bar."}
          </p>
          <button className="primary" onClick={() => void keito.openWindow()}>
            {rejected ? "Fix the connection" : "Get started"}
          </button>
        </div>
      </div>
    );
  }



  return (
    <div
      className="popover"
      onKeyDown={(event) => {
        if (event.key === "Escape") void keito.closePopover();
      }}
    >
      <header className="running">
        {running ? (
          <>
            <div className="running-what">
              <strong>{running.pair.taskName}</strong>
              <span>{running.pair.projectName}</span>
              {running.note?.trim() ? (
                <span className="running-note" title={running.note}>
                  {running.note}
                </span>
              ) : (
                <span className="running-note none">No note</span>
              )}
            </div>
            <div className="running-right">
              <Elapsed startedAtMs={running.startedAtMs} />
              <AsyncButton
                className="stop"
                title="Stop timer"
                aria-label="Stop timer"
                onClick={() => keito.stopTimer().then(setSnapshot)}
              >
                ■
              </AsyncButton>
            </div>
          </>
        ) : (
          <span className="running-what idle">Nothing running</span>
        )}
      </header>

      {idle && (
        <div className="idle-banner">
          You were away for {Math.round(idle.awaySeconds / 60)} min.
          <AsyncButton
            onClick={async () => {
              setSnapshot(await keito.resolveIdle(false, idle.awaySinceMs));
              setIdle(null);
            }}
          >
            Discard it
          </AsyncButton>
          <button className="link" onClick={() => setIdle(null)}>
            Keep it
          </button>
        </div>
      )}

      {snapshot.error && <div className="error">{snapshot.error}</div>}

      <form
        className="starter"
        onSubmit={(event) => {
          event.preventDefault();
          // Guarded, so holding Enter cannot fire a second create.
          start();
        }}
      >
        {/* Not a <label>: wrapping the picker in one forwards option clicks to the
            trigger button, which reopens the menu the moment it closes. */}
        <div className="field">
          <span className="field-label">Category</span>
          <CategoryPicker
            catalog={snapshot.catalog}
            favourites={snapshot.favourites}
            recents={snapshot.recents}
            hidden={snapshot.hidden}
            selectedId={selectedId}
            onSelect={(pairId) => {
              setSelectedId(pairId);
              // Picking a category is followed by writing a note, so go straight there.
              focusNote();
            }}
            onToggleFavourite={(pairId) => keito.toggleFavourite(pairId).then(setSnapshot)}
          />
        </div>

        <label>
          Note
          <div className="with-play">
            <input
              ref={noteRef}
              placeholder="What are you working on?"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <button
              type="submit"
              className="play"
              title="Start timer"
              aria-label="Start timer"
              aria-busy={starting}
              disabled={!selectedId || starting}
            >
              {starting ? <Spinner /> : "▶"}
            </button>
          </div>
        </label>
      </form>

      <RecentEntries
        today={snapshot.today}
        yesterday={snapshot.yesterday}
        catalog={snapshot.catalog}
        onResume={resume}
        onStartAgain={startAgain}
        onStop={() => keito.stopTimer().then(setSnapshot)}
      />

      <footer>
        <button className="link" onClick={() => void keito.openWindow()}>
          Entries &amp; settings
        </button>
        <span className="hint">⏎ to start · esc to close</span>
      </footer>
    </div>
  );
}

/**
 * The tray glyph, redrawn as inline SVG. The packaged icons live in `build/` and are
 * loaded by the main process from disk, not bundled for the renderer — and a flat mark in
 * `currentColor` follows the theme for free, which a PNG would not.
 */
function ClockMark(): JSX.Element {
  return (
    <svg
      className="onboarding-mark"
      viewBox="0 0 48 48"
      width="56"
      height="56"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="24" cy="24" r="18" />
      <path d="M24 13v11l7 5" />
    </svg>
  );
}
