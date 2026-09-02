import { useEffect, useMemo, useRef, useState } from "react";
import { buildPicker } from "../core/catalog/picker.js";
import { Elapsed } from "./Elapsed.js";
import { keito } from "./keito-api.js";
import { useSnapshot } from "./useSnapshot.js";

const SECTION_LABEL = { favourites: "Favourites", recent: "Recent", all: "All categories" } as const;

export function Popover(): JSX.Element {
  const [snapshot, setSnapshot] = useSnapshot();
  const [selectedId, setSelectedId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [idle, setIdle] = useState<{ awaySinceMs: number; awaySeconds: number } | null>(null);
  const noteRef = useRef<HTMLInputElement>(null);

  useEffect(() => keito.onIdleReturn(setIdle), []);

  const sections = useMemo(
    () =>
      snapshot
        ? buildPicker({
            catalog: snapshot.catalog,
            favourites: snapshot.favourites,
            recents: snapshot.recents,
            query: "",
          })
        : [],
    [snapshot],
  );

  const running = snapshot?.timer.status === "running" ? snapshot.timer : null;

  // Default to whatever is running, else the first suggestion — usually a favourite.
  useEffect(() => {
    if (selectedId || sections.length === 0) return;
    setSelectedId(running?.pair.id ?? sections[0]?.pairs[0]?.id ?? "");
  }, [sections, running, selectedId]);

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

  const isFavourite = snapshot.favourites.includes(selectedId);

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
        <label>
          Category
          <div className="with-star">
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              {sections.map((section) => (
                <optgroup key={section.section} label={SECTION_LABEL[section.section]}>
                  {section.pairs.map((pair) => (
                    <option key={pair.id} value={pair.id}>
                      {pair.projectName} — {pair.taskName}
                    </option>
                  ))}
                </optgroup>
              ))}
              {sections.length === 0 && <option value="">No categories available</option>}
            </select>
            <button
              type="button"
              className={`star${isFavourite ? " on" : ""}`}
              title={isFavourite ? "Remove from favourites" : "Add to favourites"}
              disabled={!selectedId}
              onClick={() => void keito.toggleFavourite(selectedId).then(setSnapshot)}
            >
              ★
            </button>
          </div>
        </label>

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

      <footer>
        <button className="link" onClick={() => void keito.openWindow()}>
          Entries &amp; settings
        </button>
        <span className="hint">⏎ to start · esc to close</span>
      </footer>
    </div>
  );
}
