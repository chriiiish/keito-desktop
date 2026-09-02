import { useEffect, useMemo, useRef, useState } from "react";
import { buildPicker } from "../core/catalog/picker.js";
import type { Pair } from "../core/keito/types.js";
import { Elapsed } from "./Elapsed.js";
import { keito } from "./keito-api.js";
import { useSnapshot } from "./useSnapshot.js";

const SECTION_LABEL = { favourites: "Favourites", recent: "Recent", all: "All categories" } as const;

export function Popover(): JSX.Element {
  const [snapshot, setSnapshot] = useSnapshot();
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState("");
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [idle, setIdle] = useState<{ awaySinceMs: number; awaySeconds: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => searchRef.current?.focus(), []);
  useEffect(() => keito.onIdleReturn(setIdle), []);

  const sections = useMemo(
    () =>
      snapshot
        ? buildPicker({
            catalog: snapshot.catalog,
            favourites: snapshot.favourites,
            recents: snapshot.recents,
            query,
          })
        : [],
    [snapshot, query],
  );

  const flat = useMemo(() => sections.flatMap((section) => section.pairs), [sections]);
  useEffect(() => setCursor(0), [query]);

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

  const start = async (pair: Pair) => {
    setBusy(true);
    const next = await keito.switchTo(pair.id, notes.trim() || undefined);
    setBusy(false);
    setSnapshot(next);
    setNotes("");
    setQuery("");
    if (!next.error) void keito.closePopover();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => Math.min(c + 1, flat.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const pair = flat[cursor];
      if (pair && !busy) void start(pair);
    } else if (event.key === "Escape") {
      void keito.closePopover();
    }
  };

  return (
    <div className="popover" onKeyDown={onKeyDown}>
      <header className="running">
        {snapshot.timer.status === "running" ? (
          <>
            <div className="running-what">
              <strong>{snapshot.timer.pair.taskName}</strong>
              <span>{snapshot.timer.pair.projectName}</span>
            </div>
            <Elapsed startedAtMs={snapshot.timer.startedAtMs} />
            <button onClick={() => void keito.stopTimer().then(setSnapshot)}>Stop</button>
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

      <input
        ref={searchRef}
        className="search"
        placeholder="Search projects and tasks…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <ul className="results">
        {sections.map((section) => (
          <li key={section.section}>
            <div className="section-label">{SECTION_LABEL[section.section]}</div>
            <ul>
              {section.pairs.map((pair) => {
                const index = flat.indexOf(pair);
                return (
                  <li
                    key={pair.id}
                    className={`row${index === cursor ? " cursor" : ""}`}
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => void start(pair)}
                  >
                    <div className="row-text">
                      <strong>{pair.taskName}</strong>
                      <span>{pair.projectName}</span>
                    </div>
                    <button
                      className={`star${snapshot.favourites.includes(pair.id) ? " on" : ""}`}
                      title="Favourite"
                      onClick={(event) => {
                        event.stopPropagation();
                        void keito.toggleFavourite(pair.id).then(setSnapshot);
                      }}
                    >
                      ★
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
        {flat.length === 0 && <li className="empty">No categories match “{query}”.</li>}
      </ul>

      <input
        className="notes"
        placeholder="Notes (optional)"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      <footer>
        <button className="link" onClick={() => void keito.openWindow()}>
          Entries &amp; settings
        </button>
        <span className="hint">↑↓ to move · ⏎ to start · esc to close</span>
      </footer>
    </div>
  );
}
