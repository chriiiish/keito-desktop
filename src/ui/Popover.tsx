import { useEffect, useMemo, useRef, useState } from "react";
import { CategoryPicker } from "./CategoryPicker.js";
import { Elapsed } from "./Elapsed.js";
import { TodayList } from "./TodayList.js";
import { keito } from "./keito-api.js";
import { useSnapshot } from "./useSnapshot.js";

export function Popover(): JSX.Element {
  const [snapshot, setSnapshot] = useSnapshot();
  const [selectedId, setSelectedId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [resuming, setResuming] = useState<string | null>(null);
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

  // The note is the field you actually type in, so it takes focus on open.
  useEffect(() => noteRef.current?.focus(), [snapshot?.keyStatus]);

  if (!snapshot) return <div className="popover loading">Loading…</div>;

  if (snapshot.keyStatus !== "ready") {
    return (
      <div className="popover">
        <p className="empty">
          Keito Timer isn’t connected yet.
          <button className="link" onClick={() => void keito.openWindow()}>
            Open settings
          </button>
        </p>
      </div>
    );
  }

  const start = async () => {
    if (!selectedId || busy) return;
    setBusy(true);
    const next = await keito.switchTo(selectedId, note.trim() || undefined);
    setBusy(false);
    setSnapshot(next);
    if (!next.error) {
      setNote("");
      void keito.closePopover();
    }
  };

  const resume = async (entryId: string) => {
    setResuming(entryId);
    const next = await keito.resumeEntry(entryId);
    setResuming(null);
    setSnapshot(next);
    if (!next.error) void keito.closePopover();
  };

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
              <button onClick={() => void keito.stopTimer().then(setSnapshot)}>Stop</button>
            </div>
          </>
        ) : (
          <span className="running-what idle">Nothing running</span>
        )}
      </header>

      {idle && (
        <div className="idle-banner">
          You were away for {Math.round(idle.awaySeconds / 60)} min.
          <button
            onClick={() => {
              void keito.resolveIdle(false, idle.awaySinceMs).then(setSnapshot);
              setIdle(null);
            }}
          >
            Discard it
          </button>
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
          void start();
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
            onSelect={setSelectedId}
            onToggleFavourite={(pairId) => void keito.toggleFavourite(pairId).then(setSnapshot)}
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
            <button type="submit" className="play" title="Start timer" disabled={!selectedId || busy}>
              ▶
            </button>
          </div>
        </label>
      </form>

      <TodayList
        entries={snapshot.today}
        catalog={snapshot.catalog}
        busyId={resuming}
        onResume={(entryId) => void resume(entryId)}
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
