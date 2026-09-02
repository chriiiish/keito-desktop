import { useEffect, useMemo, useRef, useState } from "react";
import { buildPicker } from "../core/catalog/picker.js";
import { AsyncButton } from "./AsyncButton.js";
import type { Pair } from "../core/keito/types.js";

interface CategoryPickerProps {
  catalog: readonly Pair[];
  favourites: readonly string[];
  recents: readonly string[];
  hidden: readonly string[];
  selectedId: string;
  onSelect: (pairId: string) => void;
  onToggleFavourite: (pairId: string) => Promise<unknown>;
}

/**
 * A filterable category dropdown. Native <select> can't do this: options can't hold a
 * favourite button, and there is no way to type-filter across project and task together.
 */
export function CategoryPicker({
  catalog,
  favourites,
  recents,
  hidden,
  selectedId,
  onSelect,
  onToggleFavourite,
}: CategoryPickerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const result = useMemo(
    () => buildPicker({ catalog, favourites, recents, hidden, query }),
    [catalog, favourites, recents, hidden, query],
  );

  // The flat order the arrow keys walk, matching what is rendered top to bottom.
  const flat = useMemo(
    () => [...result.favourites, ...result.recent, ...result.projects.flatMap((g) => g.pairs)],
    [result],
  );

  const selected = catalog.find((pair) => pair.id === selectedId);

  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    if (open) filterRef.current?.focus();
    else setQuery("");
  }, [open]);

  // Click-away closes, the way a dropdown should.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const choose = (pairId: string) => {
    onSelect(pairId);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => Math.min(c + 1, flat.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (event.key === "Enter") {
      // Enter picks from the list; it must not also submit the start form underneath.
      event.preventDefault();
      event.stopPropagation();
      const pair = flat[cursor];
      if (pair) choose(pair.id);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
    }
  };

  const row = (pair: Pair, label: string) => {
    const index = flat.indexOf(pair);
    return (
      <li
        key={pair.id}
        role="option"
        aria-selected={pair.id === selectedId}
        className={`option${index === cursor ? " cursor" : ""}`}
        onMouseEnter={() => setCursor(index)}
        onClick={() => choose(pair.id)}
      >
        <span className="option-label">{label}</span>
        <span onClick={(event) => event.stopPropagation()}>
          <AsyncButton
            className={`star${favourites.includes(pair.id) ? " on" : ""}`}
            title={favourites.includes(pair.id) ? "Remove from favourites" : "Add to favourites"}
            aria-label={`Favourite ${pair.projectName} ${pair.taskName}`}
            onClick={() => onToggleFavourite(pair.id)}
          >
            ★
          </AsyncButton>
        </span>
      </li>
    );
  };

  return (
    <div className="picker" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        className="picker-trigger"
        aria-label="Category"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="picker-value">
          {selected ? (
            <>
              <strong>{selected.taskName}</strong>
              <span>{selected.projectName}</span>
            </>
          ) : (
            <span className="muted">Choose a category…</span>
          )}
        </span>
        <span className="chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="picker-menu">
          <input
            ref={filterRef}
            className="picker-filter"
            placeholder="Filter projects and tasks…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ul role="listbox" className="picker-list">
            {result.favourites.length > 0 && (
              <>
                <li className="group-heading">Favourites</li>
                {result.favourites.map((pair) => row(pair, `${pair.projectName} — ${pair.taskName}`))}
              </>
            )}

            {result.recent.length > 0 && (
              <>
                <li className="group-heading">Recent</li>
                {result.recent.map((pair) => row(pair, `${pair.projectName} — ${pair.taskName}`))}
              </>
            )}

            {result.projects.length > 0 && <li className="group-heading">All projects</li>}
            {result.projects.map((group) => (
              <li key={group.projectId} className="project-group">
                <div className="project-heading">{group.projectName}</div>
                <ul>{group.pairs.map((pair) => row(pair, pair.taskName))}</ul>
              </li>
            ))}

            {result.isEmpty && <li className="empty">Nothing matches “{query}”.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
